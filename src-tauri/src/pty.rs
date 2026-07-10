use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{Channel, Response};

/// Max buffered PTY output per terminal (~100KB ≈ 50 screens of text)
const MAX_BUFFER_SIZE: usize = 102_400;

/// Read buffer size for the PTY reader thread.  A single blocking read returns
/// whatever the kernel has queued — up to this limit.  Bursts naturally arrive
/// in large chunks; interactive keystrokes return a tiny read immediately.
/// No coalescing loop needed: one read → one flush, zero stall risk.
const READ_BUF_SIZE: usize = 32_768;

/// Maximum raw channel payload bytes sent to the current frontend attachment
/// but not yet acknowledged. Tauri stores larger raw channel payloads in an
/// in-memory fetch queue, so the backend must bound this before calling send.
const MAX_OUTSTANDING_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitedPayload {
    pub pty_id: String,
    pub exit_code: Option<u32>,
}

struct TerminalAttachment {
    id: String,
    channel: Channel<Response>,
}

struct TerminalStream {
    // Raw byte body: a `Channel<Vec<u8>>` would serialize each chunk as a JSON
    // number-array (the blanket `impl<T: Serialize> IpcResponse`), so a 32 KB
    // read becomes ~100 KB of ASCII that the webview must `JSON.parse` and copy.
    // Sending `Response` (→ `InvokeResponseBody::Raw`) delivers a binary
    // ArrayBuffer instead: no JSON encode in Rust, no parse in JS, zero-copy
    // `new Uint8Array(buffer)` on the frontend.
    attachment: Option<TerminalAttachment>,
    outstanding_bytes: usize,
    replay: VecDeque<u8>,
    buffer: VecDeque<u8>,
    last_output_at: Option<u64>,
}

struct TerminalStreamState {
    inner: Mutex<TerminalStream>,
    credit_available: Condvar,
}

struct TerminalInstance {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    stream: Arc<TerminalStreamState>,
    cwd: Option<PathBuf>,
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

impl TerminalStreamState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(TerminalStream {
                attachment: None,
                outstanding_bytes: 0,
                replay: VecDeque::new(),
                buffer: VecDeque::new(),
                last_output_at: None,
            }),
            credit_available: Condvar::new(),
        }
    }

    fn attach(&self, attachment_id: String, channel: Channel<Response>) -> Result<(), String> {
        let mut stream = self
            .inner
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let buffered: Vec<u8> = stream.buffer.drain(..).collect();
        stream.attachment = Some(TerminalAttachment {
            id: attachment_id,
            channel,
        });
        stream.outstanding_bytes = 0;
        self.credit_available.notify_all();

        if !buffered.is_empty() {
            let send_failed = stream.attachment.as_ref().is_some_and(|attachment| {
                attachment
                    .channel
                    .send(Response::new(buffered.clone()))
                    .is_err()
            });
            if send_failed {
                stream.attachment = None;
                extend_buffer(&mut stream.buffer, &buffered);
            } else {
                stream.outstanding_bytes = buffered.len();
            }
        }
        Ok(())
    }

    fn detach(&self, attachment_id: &str) -> Result<bool, String> {
        let mut stream = self
            .inner
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if stream
            .attachment
            .as_ref()
            .is_none_or(|attachment| attachment.id != attachment_id)
        {
            return Ok(false);
        }
        stream.attachment = None;
        stream.outstanding_bytes = 0;
        self.credit_available.notify_all();
        Ok(true)
    }

    fn acknowledge(&self, attachment_id: &str, bytes: usize) -> Result<bool, String> {
        let mut stream = self
            .inner
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if stream
            .attachment
            .as_ref()
            .is_none_or(|attachment| attachment.id != attachment_id)
        {
            return Ok(false);
        }
        let previous = stream.outstanding_bytes;
        stream.outstanding_bytes = stream.outstanding_bytes.saturating_sub(bytes);
        if stream.outstanding_bytes < previous {
            self.credit_available.notify_all();
        }
        Ok(true)
    }

    fn deactivate(&self) {
        if let Ok(mut stream) = self.inner.lock() {
            stream.attachment = None;
            stream.outstanding_bytes = 0;
        }
        self.credit_available.notify_all();
    }
}

/// Drain `batch` into the stream (replay + live channel / fallback buffer).
/// The current attachment may have at most `MAX_OUTSTANDING_BYTES` queued in
/// Tauri. Waiting before `Channel::send` lets the kernel PTY buffer provide
/// natural backpressure instead of allowing Tauri's raw-payload map to grow.
fn flush_batch(stream_ref: &Arc<TerminalStreamState>, batch: &mut Vec<u8>) {
    if batch.is_empty() {
        return;
    }
    let Ok(mut stream) = stream_ref.inner.lock() else {
        batch.clear();
        return; // mutex poisoned — caller will break
    };
    extend_buffer(&mut stream.replay, batch);
    stream.last_output_at = Some(now_ms());

    loop {
        if stream.attachment.is_none() {
            extend_buffer(&mut stream.buffer, batch);
            batch.clear();
            return;
        }

        if stream.outstanding_bytes.saturating_add(batch.len()) > MAX_OUTSTANDING_BYTES {
            match stream_ref.credit_available.wait(stream) {
                Ok(guard) => {
                    stream = guard;
                    continue;
                }
                Err(_) => {
                    batch.clear();
                    return;
                }
            }
        }

        // `Response` is not Clone. Keep a byte copy for the rare send-error
        // fallback, which must be replayable by a later attachment.
        let payload = std::mem::take(batch);
        let send_failed = stream.attachment.as_ref().is_some_and(|attachment| {
            attachment
                .channel
                .send(Response::new(payload.clone()))
                .is_err()
        });
        if send_failed {
            stream.attachment = None;
            stream.outstanding_bytes = 0;
            extend_buffer(&mut stream.buffer, &payload);
            stream_ref.credit_available.notify_all();
        } else {
            stream.outstanding_bytes += payload.len();
        }
        return;
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

    pub fn spawn<F>(
        &self,
        shell: &str,
        cwd: Option<&str>,
        rows: u16,
        cols: u16,
        on_exit: F,
    ) -> Result<String, String>
    where
        F: FnOnce(TerminalExitedPayload) + Send + 'static,
    {
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

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let killer = child.clone_killer();
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let id = uuid::Uuid::new_v4().to_string();

        let stream = Arc::new(TerminalStreamState::new());

        let instance = TerminalInstance {
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer,
            stream: Arc::clone(&stream),
            cwd: cwd_path,
        };

        self.inner
            .terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(id.clone(), instance);

        let (reader_done_tx, reader_done_rx) = std::sync::mpsc::sync_channel(1);
        let stream_ref = Arc::clone(&stream);
        std::thread::spawn(move || {
            // One blocking read per iteration — the kernel returns whatever is
            // queued (up to READ_BUF_SIZE), so bursts arrive in large chunks
            // while interactive keystrokes flush immediately after a tiny read.
            // No coalescing loop: we send only the filled prefix, never the
            // full 32 KB allocation.
            let mut buf = [0u8; READ_BUF_SIZE];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let mut payload = buf[..n].to_vec();
                        flush_batch(&stream_ref, &mut payload);
                    }
                    Err(_) => break,
                }
            }
            let _ = reader_done_tx.send(());
        });

        // Keep ownership of `child` in a dedicated waiter. Dropping it without
        // wait leaves a zombie on Unix. The waiter also removes completed PTYs
        // from backend state and wakes any reader blocked on frontend credit.
        let state = self.clone();
        let exited_id = id.clone();
        std::thread::spawn(move || {
            let exit_code = child.wait().ok().map(|status| status.exit_code());
            // Normally the PTY reader observes EOF immediately after the child
            // exits. Give it a short bounded window to deliver final command
            // output before detaching the channel and announcing the stopped
            // session. Descendants may inherit the PTY, so never wait forever.
            let _ = reader_done_rx.recv_timeout(std::time::Duration::from_millis(250));
            let removed = state
                .inner
                .terminals
                .lock()
                .ok()
                .and_then(|mut terminals| terminals.remove(&exited_id));
            if let Some(instance) = removed {
                instance.stream.deactivate();
            } else {
                stream.deactivate();
            }
            on_exit(TerminalExitedPayload {
                pty_id: exited_id,
                exit_code,
            });
        });

        Ok(id)
    }

    pub fn attach(
        &self,
        id: &str,
        attachment_id: String,
        channel: Channel<Response>,
    ) -> Result<(), String> {
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };
        stream_arc.attach(attachment_id, channel)
    }

    pub fn detach(&self, id: &str, attachment_id: &str) -> Result<(), String> {
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };
        stream_arc.detach(attachment_id)?;
        Ok(())
    }

    pub fn acknowledge(&self, id: &str, attachment_id: &str, bytes: usize) -> Result<(), String> {
        let stream_arc = {
            let terminals = self
                .inner
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };
        stream_arc.acknowledge(attachment_id, bytes)?;
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
        let mut terminals = self
            .inner
            .terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if let Some(instance) = terminals.get_mut(id) {
            // Detach and reset credit before killing so a reader waiting for an
            // ACK wakes and falls back to the bounded detached buffer.
            instance.stream.deactivate();
            // Keep the instance addressable until the waiter reaps and removes
            // it. If signalling fails, propagate the error so the frontend can
            // restore the session instead of silently orphaning a live child.
            instance.killer.kill().map_err(|error| error.to_string())?;
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
                .inner
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
                .inner
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
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    fn accepting_channel() -> Channel<Response> {
        Channel::new(|_| Ok(()))
    }

    #[test]
    fn terminal_exited_payload_serializes_for_frontend_contract() {
        let payload = TerminalExitedPayload {
            pty_id: "pty-123".to_string(),
            exit_code: Some(7),
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({ "ptyId": "pty-123", "exitCode": 7 })
        );
    }

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
        let stream = Arc::new(TerminalStreamState::new());

        {
            let mut s = stream.inner.lock().unwrap();
            extend_buffer(&mut s.buffer, b"buffered data");
        }

        let s = stream.inner.lock().unwrap();
        assert_eq!(s.buffer.len(), 13);
        assert!(s.attachment.is_none());
    }

    #[test]
    fn detach_preserves_buffer() {
        let stream = TerminalStreamState::new();

        {
            let mut s = stream.inner.lock().unwrap();
            s.buffer = VecDeque::from(b"existing data".to_vec());
        }
        assert!(!stream.detach("stale").unwrap());

        let s = stream.inner.lock().unwrap();
        assert!(s.attachment.is_none());
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
        let stream = Arc::new(TerminalStreamState::new());
        let mut batch = b"hello coalesced".to_vec();
        flush_batch(&stream, &mut batch);
        assert!(batch.is_empty(), "batch should be cleared after flush");
        let s = stream.inner.lock().unwrap();
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
        let stream = Arc::new(TerminalStreamState::new());
        let mut batch: Vec<u8> = Vec::new();
        flush_batch(&stream, &mut batch);
        let s = stream.inner.lock().unwrap();
        assert!(s.replay.is_empty());
        assert!(s.last_output_at.is_none());
    }

    #[test]
    fn stale_detach_and_ack_do_not_affect_current_attachment() {
        let stream = TerminalStreamState::new();
        stream
            .attach("first".to_string(), accepting_channel())
            .unwrap();
        stream
            .attach("second".to_string(), accepting_channel())
            .unwrap();
        {
            let mut inner = stream.inner.lock().unwrap();
            inner.outstanding_bytes = 42_000;
        }

        assert!(!stream.detach("first").unwrap());
        assert!(!stream.acknowledge("first", 42_000).unwrap());
        {
            let inner = stream.inner.lock().unwrap();
            assert_eq!(inner.outstanding_bytes, 42_000);
            assert_eq!(
                inner
                    .attachment
                    .as_ref()
                    .map(|attachment| attachment.id.as_str()),
                Some("second")
            );
        }

        assert!(stream.detach("second").unwrap());
        let inner = stream.inner.lock().unwrap();
        assert!(inner.attachment.is_none());
        assert_eq!(inner.outstanding_bytes, 0);
    }

    #[test]
    fn output_waits_at_credit_limit_until_current_attachment_acks() {
        let stream = Arc::new(TerminalStreamState::new());
        stream
            .attach("current".to_string(), accepting_channel())
            .unwrap();
        stream.inner.lock().unwrap().outstanding_bytes = MAX_OUTSTANDING_BYTES;

        let (done_tx, done_rx) = mpsc::channel();
        let worker_stream = Arc::clone(&stream);
        thread::spawn(move || {
            let mut payload = vec![b'x'; READ_BUF_SIZE];
            flush_batch(&worker_stream, &mut payload);
            done_tx.send(()).unwrap();
        });

        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
        assert!(!stream.acknowledge("stale", READ_BUF_SIZE).unwrap());
        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());

        assert!(stream.acknowledge("current", READ_BUF_SIZE).unwrap());
        done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("ACK should release the credit-blocked writer");
        assert_eq!(
            stream.inner.lock().unwrap().outstanding_bytes,
            MAX_OUTSTANDING_BYTES
        );
    }

    #[test]
    fn detach_wakes_credit_waiter_and_buffers_payload() {
        let stream = Arc::new(TerminalStreamState::new());
        stream
            .attach("current".to_string(), accepting_channel())
            .unwrap();
        stream.inner.lock().unwrap().outstanding_bytes = MAX_OUTSTANDING_BYTES;

        let (done_tx, done_rx) = mpsc::channel();
        let worker_stream = Arc::clone(&stream);
        thread::spawn(move || {
            let mut payload = b"pending".to_vec();
            flush_batch(&worker_stream, &mut payload);
            done_tx.send(()).unwrap();
        });

        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
        assert!(stream.detach("current").unwrap());
        done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("detach should release the credit-blocked writer");

        let inner = stream.inner.lock().unwrap();
        assert_eq!(inner.buffer.iter().copied().collect::<Vec<_>>(), b"pending");
        assert_eq!(inner.outstanding_bytes, 0);
    }

    #[test]
    fn deactivate_wakes_credit_waiter_and_buffers_payload() {
        let stream = Arc::new(TerminalStreamState::new());
        stream
            .attach("current".to_string(), accepting_channel())
            .unwrap();
        stream.inner.lock().unwrap().outstanding_bytes = MAX_OUTSTANDING_BYTES;

        let (done_tx, done_rx) = mpsc::channel();
        let worker_stream = Arc::clone(&stream);
        thread::spawn(move || {
            let mut payload = b"pending after kill".to_vec();
            flush_batch(&worker_stream, &mut payload);
            done_tx.send(()).unwrap();
        });

        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
        stream.deactivate();
        done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("kill/exit deactivation should release the credit-blocked writer");

        let inner = stream.inner.lock().unwrap();
        assert_eq!(
            inner.buffer.iter().copied().collect::<Vec<_>>(),
            b"pending after kill"
        );
        assert_eq!(inner.outstanding_bytes, 0);
    }

    #[test]
    fn exited_child_is_reaped_removed_and_reported() {
        let false_path = ["/usr/bin/false", "/bin/false"]
            .into_iter()
            .find(|path| std::path::Path::new(path).exists())
            .expect("false executable should exist");
        let state = PtyState::new();
        let (exit_tx, exit_rx) = mpsc::channel();
        let id = state
            .spawn(false_path, None, 24, 80, move |payload| {
                exit_tx.send(payload).unwrap();
            })
            .unwrap();

        let payload = exit_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("short-lived PTY child should be waited and reported");
        assert_eq!(payload.pty_id, id);
        assert!(payload.exit_code.is_some_and(|code| code != 0));
        assert!(
            state.preview(&id, 10).is_err(),
            "exited PTY must be removed"
        );
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
