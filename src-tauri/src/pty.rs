use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::{Channel, Response};

/// Max buffered PTY output per terminal (~100KB ≈ 50 screens of text)
const MAX_BUFFER_SIZE: usize = 102_400;

/// Read buffer size for the PTY reader thread.  A single blocking read returns
/// whatever the kernel has queued — up to this limit.  Bursts naturally arrive
/// in large chunks; interactive keystrokes return a tiny read immediately.
/// No coalescing loop needed: one read → one flush, zero stall risk.
const READ_BUF_SIZE: usize = 32_768;

struct TerminalStream {
    // Raw byte body: a `Channel<Vec<u8>>` would serialize each chunk as a JSON
    // number-array (the blanket `impl<T: Serialize> IpcResponse`), so a 32 KB
    // read becomes ~100 KB of ASCII that the webview must `JSON.parse` and copy.
    // Sending `Response` (→ `InvokeResponseBody::Raw`) delivers a binary
    // ArrayBuffer instead: no JSON encode in Rust, no parse in JS, zero-copy
    // `new Uint8Array(buffer)` on the frontend.
    channel: Option<Channel<Response>>,
    replay: VecDeque<u8>,
    buffer: VecDeque<u8>,
    last_output_at: Option<u64>,
}

struct TerminalInstance {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    stream: Arc<Mutex<TerminalStream>>,
    cwd: Option<PathBuf>,
    /// Flow-control gate for the read thread. When `true`, the reader stops
    /// pulling from the PTY so the kernel buffer fills and the child process
    /// blocks (natural backpressure). The frontend sets this when its xterm
    /// parse buffer is backed up (see pause_read / resume_read) and clears it
    /// as xterm drains, preventing unbounded IPC queue / memory growth on
    /// floods (`yes`, huge `cat`, many busy agents).
    read_pause: Arc<(Mutex<bool>, Condvar)>,
}

struct PtyStateInner {
    terminals: Mutex<HashMap<String, TerminalInstance>>,
}

#[derive(Clone)]
pub struct PtyState {
    inner: Arc<PtyStateInner>,
}

pub struct PtyAgentProbe {
    pub cwd: Option<String>,
    pub foreground_process_group: Option<i32>,
    pub scrollback: String,
    pub last_output_at: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn extend_buffer(buffer: &mut VecDeque<u8>, data: &[u8]) {
    buffer.extend(data);
    if buffer.len() > MAX_BUFFER_SIZE {
        let excess = buffer.len() - MAX_BUFFER_SIZE;
        buffer.drain(..excess);
    }
}

fn decode_replay_tail(replay: &VecDeque<u8>, max_bytes: usize) -> String {
    if max_bytes == 0 || replay.is_empty() {
        return String::new();
    }

    let bytes_to_take = replay.len().min(max_bytes);
    let skip = replay.len() - bytes_to_take;
    let (front, back) = replay.as_slices();

    if skip < front.len() {
        let mut text = String::from_utf8_lossy(&front[skip..]).into_owned();
        if !back.is_empty() {
            text.push_str(&String::from_utf8_lossy(back));
        }
        text
    } else {
        let back_skip = skip - front.len();
        String::from_utf8_lossy(&back[back_skip..]).into_owned()
    }
}

/// Drain `batch` into the stream (replay + live channel / fallback buffer).
/// SAFETY: Channel::send() is fire-and-forget in Tauri 2 (it `webview.eval()`s
/// a callback, or for larger Raw payloads queues the bytes and evals a fetch —
/// neither blocks on webview processing), so holding the stream mutex during
/// send is safe and cannot deadlock.
fn flush_batch(stream_ref: &Arc<Mutex<TerminalStream>>, batch: &mut Vec<u8>) {
    if batch.is_empty() {
        return;
    }
    let Ok(mut stream) = stream_ref.lock() else {
        batch.clear();
        return; // mutex poisoned — caller will break
    };
    extend_buffer(&mut stream.replay, batch);
    stream.last_output_at = Some(now_ms());
    if let Some(ch) = stream.channel.as_ref() {
        // take ownership: either the send succeeds or we need the data for
        // the fallback buffer below, so swap out of batch unconditionally.
        // `Response` is not `Clone`, so clone the bytes (cheap ≤32 KB memcpy)
        // and reconstruct the Response per send; `payload` survives for the
        // rare send-error fallback into the reattach buffer.
        let payload = std::mem::take(batch);
        if ch.send(Response::new(payload.clone())).is_err() {
            // Channel closed — fall back to buffering
            stream.channel = None;
            extend_buffer(&mut stream.buffer, &payload);
        }
    } else {
        extend_buffer(&mut stream.buffer, batch);
        batch.clear();
    }
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(PtyStateInner {
                terminals: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn spawn(
        &self,
        shell: &str,
        cwd: Option<&str>,
        rows: u16,
        cols: u16,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        let cwd_path = cwd.and_then(|dir| {
            let path = std::path::Path::new(dir);
            path.is_dir()
                .then(|| path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
        });
        if let Some(path) = cwd_path.as_deref() {
            cmd.cwd(path);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let killer = child.clone_killer();
        drop(child);
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let id = uuid::Uuid::new_v4().to_string();

        let stream = Arc::new(Mutex::new(TerminalStream {
            channel: None,
            replay: VecDeque::new(),
            buffer: VecDeque::new(),
            last_output_at: None,
        }));

        let read_pause = Arc::new((Mutex::new(false), Condvar::new()));

        let stream_ref = Arc::clone(&stream);
        let pause_pair = Arc::clone(&read_pause);
        std::thread::spawn(move || {
            // One blocking read per iteration — the kernel returns whatever is
            // queued (up to READ_BUF_SIZE), so bursts arrive in large chunks
            // while interactive keystrokes flush immediately after a tiny read.
            // No coalescing loop: we send only the filled prefix, never the
            // full 32 KB allocation.
            let mut buf = [0u8; READ_BUF_SIZE];
            loop {
                // Flow control: block here while the frontend has paused us
                // because its xterm parse buffer is backed up. Not reading lets
                // the kernel PTY buffer fill so the child blocks. `wait_timeout`
                // is only a missed-notify safety net — we keep waiting until the
                // flag actually clears, so a flood can never slip through.
                {
                    let (lock, cvar) = &*pause_pair;
                    let Ok(mut paused) = lock.lock() else { break };
                    while *paused {
                        match cvar.wait_timeout(paused, Duration::from_millis(200)) {
                            Ok((guard, _)) => paused = guard,
                            Err(_) => return,
                        }
                    }
                }
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let mut payload = buf[..n].to_vec();
                        flush_batch(&stream_ref, &mut payload);
                    }
                    Err(_) => break,
                }
            }
        });

        let instance = TerminalInstance {
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer,
            stream,
            cwd: cwd_path,
            read_pause,
        };

        self.inner
            .terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(id.clone(), instance);
        Ok(id)
    }

    pub fn attach(&self, id: &str, channel: Channel<Response>) -> Result<(), String> {
        // Clone the stream Arc, then release the outer terminals lock before
        // acquiring the inner stream lock. This prevents nested-lock risk.
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };

        let mut stream = stream_arc
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        // Drain buffer for replay
        let buffered: Vec<u8> = stream.buffer.drain(..).collect();

        // Set live channel before replay — ensures no gap between replay and
        // live data (read thread is blocked on this same lock).
        stream.channel = Some(channel);

        // Replay buffered output to the newly attached channel
        if !buffered.is_empty() {
            let send_failed = match stream.channel.as_ref() {
                Some(ch) => ch.send(Response::new(buffered.clone())).is_err(),
                None => false,
            };
            if send_failed {
                // Channel broke before the replay landed — re-buffer it so the
                // next attach replays it instead of losing it (mirror flush_batch).
                stream.channel = None;
                extend_buffer(&mut stream.buffer, &buffered);
            }
        }
        drop(stream);

        // A fresh attach starts unpaused — clear any flow-control pause left by
        // a prior session so the read thread streams again.
        self.set_read_paused(id, false);
        Ok(())
    }

    /// Pause the read thread (frontend flow control: its xterm parse buffer is
    /// backed up). The kernel PTY buffer then fills and the child blocks.
    pub fn pause_read(&self, id: &str) -> Result<(), String> {
        self.set_read_paused(id, true);
        Ok(())
    }

    /// Resume a paused read thread once the frontend has drained.
    pub fn resume_read(&self, id: &str) -> Result<(), String> {
        self.set_read_paused(id, false);
        Ok(())
    }

    fn set_read_paused(&self, id: &str, paused: bool) {
        // Clone the pause Arc out under the terminals lock, then release it
        // before touching the pause mutex (terminals → pause lock order only).
        let pair = {
            let Ok(terminals) = self.inner.terminals.lock() else {
                return;
            };
            let Some(instance) = terminals.get(id) else {
                return;
            };
            Arc::clone(&instance.read_pause)
        };
        let (lock, cvar) = &*pair;
        if let Ok(mut guard) = lock.lock() {
            *guard = paused;
        }
        if !paused {
            cvar.notify_all();
        }
    }

    pub fn detach(&self, id: &str) -> Result<(), String> {
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };

        {
            let mut stream = stream_arc
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            // Remove channel — read thread switches to buffering
            stream.channel = None;
        }

        // A detached terminal keeps buffering recent output for replay/preview,
        // so it must not stay paused by stale frontend flow control.
        self.set_read_paused(id, false);
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        // Clone writer Arc, then release the outer terminals lock before
        // the blocking write_all call. Prevents deadlock on paste + resize.
        let writer = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.writer)
        };
        let mut writer = writer.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        writer.write_all(data).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        // Clone master Arc, then release the outer terminals lock before
        // the resize ioctl. Prevents deadlock during drag-resize.
        let master = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.master)
        };
        let master = master.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let instance = self
            .inner
            .terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .remove(id);
        if let Some(mut inst) = instance {
            // Wake a paused reader so it observes the kill (EOF) and exits
            // instead of parking on the flow-control condvar.
            {
                let (lock, cvar) = &*inst.read_pause;
                if let Ok(mut paused) = lock.lock() {
                    *paused = false;
                }
                cvar.notify_all();
            }
            let _ = inst.killer.kill();
        }
        Ok(())
    }

    /// ANSI-stripped tail of the replay buffer, for static terminal previews
    /// while the xterm instance is detached (live-budget eviction, low zoom).
    pub fn preview(&self, id: &str, max_lines: usize) -> Result<String, String> {
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };

        let raw = {
            let stream = stream_arc
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            let (front, back) = stream.replay.as_slices();
            if back.is_empty() {
                String::from_utf8_lossy(front).into_owned()
            } else {
                let mut s = String::from_utf8_lossy(front).into_owned();
                s.push_str(&String::from_utf8_lossy(back));
                s
            }
        };

        // Strip + tail outside the stream lock — the reader thread must
        // never wait on text processing.
        let stripped = crate::agent_status::strip_ansi(&raw);
        Ok(preview_tail(&stripped, max_lines))
    }

    pub fn agent_probe(
        &self,
        id: &str,
        max_scrollback_bytes: usize,
    ) -> Result<PtyAgentProbe, String> {
        let (master_arc, stream_arc, cwd) = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            let terminal = terminals.get(id).ok_or("Terminal not found")?;
            (
                Arc::clone(&terminal.master),
                Arc::clone(&terminal.stream),
                terminal.cwd.clone(),
            )
        };

        let foreground_process_group = {
            let master = master_arc
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            master.process_group_leader()
        };

        let (scrollback, last_output_at) = {
            let stream = stream_arc
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            // Agent status only needs recent bottom-of-buffer markers. Decode a
            // bounded tail instead of materializing the full ~100 KB replay every
            // poll tick for every terminal.
            let scrollback = decode_replay_tail(&stream.replay, max_scrollback_bytes);
            (scrollback, stream.last_output_at)
        };

        Ok(PtyAgentProbe {
            cwd: cwd.map(|path| path.to_string_lossy().to_string()),
            foreground_process_group,
            scrollback,
            last_output_at,
        })
    }
}

/// Plain-text tail of an ANSI-stripped terminal stream for static previews.
/// Emulates mid-line carriage-return overwrites (progress bars), drops
/// trailing blank lines, caps line length, and returns at most `max_lines`.
pub(crate) fn preview_tail(stripped: &str, max_lines: usize) -> String {
    const MAX_LINE_CHARS: usize = 500;
    let mut lines: Vec<String> = stripped
        .lines()
        .map(|line| {
            let visible = line.rsplit('\r').next().unwrap_or(line);
            visible.chars().take(MAX_LINE_CHARS).collect()
        })
        .collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_tail_takes_last_lines_and_trims_trailing_blanks() {
        let text = "one\ntwo\nthree\n\n   \n";
        assert_eq!(preview_tail(text, 2), "two\nthree");
        assert_eq!(preview_tail(text, 10), "one\ntwo\nthree");
    }

    #[test]
    fn preview_tail_emulates_carriage_return_overwrite() {
        let text = "downloading 10%\rdownloading 99%\ndone";
        assert_eq!(preview_tail(text, 10), "downloading 99%\ndone");
    }

    #[test]
    fn preview_tail_empty_input() {
        assert_eq!(preview_tail("", 10), "");
        assert_eq!(preview_tail("\n\n", 10), "");
    }

    #[test]
    fn extend_buffer_within_limit() {
        let mut buf = VecDeque::new();
        extend_buffer(&mut buf, b"hello");
        assert_eq!(buf.len(), 5);
        assert_eq!(buf.iter().copied().collect::<Vec<u8>>(), b"hello");
    }

    #[test]
    fn extend_buffer_exactly_at_limit() {
        let mut buf = VecDeque::new();
        let data = vec![b'A'; MAX_BUFFER_SIZE];
        extend_buffer(&mut buf, &data);
        assert_eq!(buf.len(), MAX_BUFFER_SIZE);
    }

    #[test]
    fn extend_buffer_trims_oldest_on_overflow() {
        let mut buf = VecDeque::new();
        let fill = vec![b'A'; MAX_BUFFER_SIZE];
        extend_buffer(&mut buf, &fill);

        // Add 10 more bytes — oldest 10 should be evicted
        extend_buffer(&mut buf, b"0123456789");
        assert_eq!(buf.len(), MAX_BUFFER_SIZE);

        // Last 10 bytes should be the new data
        let tail: Vec<u8> = buf.iter().rev().take(10).rev().copied().collect();
        assert_eq!(tail, b"0123456789");

        // First byte should still be 'A' (the first 10 A's were evicted)
        assert_eq!(*buf.front().unwrap(), b'A');
    }

    #[test]
    fn extend_buffer_single_write_exceeding_limit() {
        let mut buf = VecDeque::new();
        let data = vec![b'X'; MAX_BUFFER_SIZE + 500];
        extend_buffer(&mut buf, &data);
        assert_eq!(buf.len(), MAX_BUFFER_SIZE);
        // All remaining bytes are 'X'
        assert!(buf.iter().all(|&b| b == b'X'));
    }

    #[test]
    fn extend_buffer_incremental_fills() {
        let mut buf = VecDeque::new();
        // Fill in 1KB chunks past the limit
        let chunk = vec![b'Z'; 1024];
        for _ in 0..200 {
            extend_buffer(&mut buf, &chunk);
        }
        // 200 * 1024 = 204800 > MAX_BUFFER_SIZE
        assert_eq!(buf.len(), MAX_BUFFER_SIZE);
    }

    #[test]
    fn stream_buffers_when_no_channel() {
        let stream = Arc::new(Mutex::new(TerminalStream {
            channel: None,
            replay: VecDeque::new(),
            buffer: VecDeque::new(),
            last_output_at: None,
        }));

        {
            let mut s = stream.lock().unwrap();
            extend_buffer(&mut s.buffer, b"buffered data");
        }

        let s = stream.lock().unwrap();
        assert_eq!(s.buffer.len(), 13);
        assert!(s.channel.is_none());
    }

    #[test]
    fn detach_preserves_buffer() {
        let stream = Arc::new(Mutex::new(TerminalStream {
            channel: None,
            replay: VecDeque::new(),
            buffer: VecDeque::from(b"existing data".to_vec()),
            last_output_at: None,
        }));

        // Simulate detach: set channel to None
        {
            let mut s = stream.lock().unwrap();
            s.channel = None;
        }

        // Buffer should be preserved
        let s = stream.lock().unwrap();
        assert!(s.channel.is_none());
        assert_eq!(s.buffer.len(), 13);
    }

    #[test]
    fn buffer_accumulates_across_writes() {
        let mut buf = VecDeque::new();
        extend_buffer(&mut buf, b"first ");
        extend_buffer(&mut buf, b"second ");
        extend_buffer(&mut buf, b"third");
        let content: Vec<u8> = buf.iter().copied().collect();
        assert_eq!(content, b"first second third");
    }

    #[test]
    fn decode_replay_tail_respects_byte_limit() {
        let replay = VecDeque::from(b"old output that should not be decoded\nrecent tail".to_vec());

        assert_eq!(decode_replay_tail(&replay, 0), "");
        assert_eq!(
            decode_replay_tail(&replay, b"recent tail".len()),
            "recent tail"
        );
    }

    #[test]
    fn decode_replay_tail_handles_split_vecdeque() {
        let mut replay = VecDeque::with_capacity(16);
        replay.extend(b"abcdefgh");
        for _ in 0..6 {
            replay.pop_front();
        }
        replay.extend(b"ijklmnopqrst");
        assert!(
            !replay.as_slices().1.is_empty(),
            "test setup should force a split VecDeque",
        );

        assert_eq!(decode_replay_tail(&replay, 7), "nopqrst");
    }

    // ── flush_batch / coalescing helpers ────────────────────────────────────

    #[test]
    fn flush_batch_writes_to_replay_and_buffer_without_channel() {
        let stream = Arc::new(Mutex::new(TerminalStream {
            channel: None,
            replay: VecDeque::new(),
            buffer: VecDeque::new(),
            last_output_at: None,
        }));
        let mut batch = b"hello coalesced".to_vec();
        flush_batch(&stream, &mut batch);
        assert!(batch.is_empty(), "batch should be cleared after flush");
        let s = stream.lock().unwrap();
        assert_eq!(
            s.replay.iter().copied().collect::<Vec<_>>(),
            b"hello coalesced"
        );
        assert_eq!(
            s.buffer.iter().copied().collect::<Vec<_>>(),
            b"hello coalesced"
        );
        assert!(s.last_output_at.is_some());
    }

    #[test]
    fn flush_batch_is_noop_on_empty_batch() {
        let stream = Arc::new(Mutex::new(TerminalStream {
            channel: None,
            replay: VecDeque::new(),
            buffer: VecDeque::new(),
            last_output_at: None,
        }));
        let mut batch: Vec<u8> = Vec::new();
        flush_batch(&stream, &mut batch);
        let s = stream.lock().unwrap();
        assert!(s.replay.is_empty());
        assert!(s.last_output_at.is_none());
    }

    #[test]
    fn as_slices_scrollback_matches_iter_collect() {
        let mut replay: VecDeque<u8> = VecDeque::new();
        // Fill past capacity so the deque wraps and has two slices.
        for _ in 0..3 {
            extend_buffer(&mut replay, b"AAAA");
            extend_buffer(&mut replay, b"BBBB");
        }
        let via_iter: Vec<u8> = replay.iter().copied().collect();
        let (front, back) = replay.as_slices();
        let via_slices = if back.is_empty() {
            front.to_vec()
        } else {
            let mut v = front.to_vec();
            v.extend_from_slice(back);
            v
        };
        assert_eq!(via_iter, via_slices);
    }
}
