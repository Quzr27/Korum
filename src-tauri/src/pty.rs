use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// Max buffered PTY output per terminal (~100KB ≈ 50 screens of text)
const MAX_BUFFER_SIZE: usize = 102_400;

struct TerminalStream {
    channel: Option<Channel<Vec<u8>>>,
    buffer: VecDeque<u8>,
}

struct TerminalInstance {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    stream: Arc<Mutex<TerminalStream>>,
}

pub struct PtyState {
    terminals: Mutex<HashMap<String, TerminalInstance>>,
}

fn extend_buffer(buffer: &mut VecDeque<u8>, data: &[u8]) {
    buffer.extend(data);
    if buffer.len() > MAX_BUFFER_SIZE {
        let excess = buffer.len() - MAX_BUFFER_SIZE;
        buffer.drain(..excess);
    }
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
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
        if let Some(dir) = cwd {
            let path = std::path::Path::new(dir);
            if path.is_dir() {
                cmd.cwd(path);
            }
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
            buffer: VecDeque::new(),
        }));

        let stream_ref = Arc::clone(&stream);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &buf[..n];
                        // SAFETY: Channel::send() is fire-and-forget in Tauri 2
                        // (webview.eval() does not block), so holding the stream
                        // mutex during send is safe and cannot deadlock.
                        let Ok(mut stream) = stream_ref.lock() else {
                            break; // mutex poisoned — exit read loop
                        };
                        if let Some(ch) = stream.channel.as_ref() {
                            if ch.send(data.to_vec()).is_err() {
                                // Channel closed — fall back to buffering
                                stream.channel = None;
                                extend_buffer(&mut stream.buffer, data);
                            }
                        } else {
                            extend_buffer(&mut stream.buffer, data);
                        }
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
        };

        self.terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(id.clone(), instance);
        Ok(id)
    }

    pub fn attach(&self, id: &str, channel: Channel<Vec<u8>>) -> Result<(), String> {
        // Clone the stream Arc, then release the outer terminals lock before
        // acquiring the inner stream lock. This prevents nested-lock risk.
        let stream_arc = {
            let terminals = self
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
            if let Some(ch) = stream.channel.as_ref() {
                if ch.send(buffered).is_err() {
                    // Channel broken — read thread will also fail and fall back to buffering
                    stream.channel = None;
                }
            }
        }

        Ok(())
    }

    pub fn detach(&self, id: &str) -> Result<(), String> {
        let stream_arc = {
            let terminals = self
                .terminals
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            Arc::clone(&terminals.get(id).ok_or("Terminal not found")?.stream)
        };

        let mut stream = stream_arc
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        // Remove channel — read thread switches to buffering
        stream.channel = None;
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        // Clone writer Arc, then release the outer terminals lock before
        // the blocking write_all call. Prevents deadlock on paste + resize.
        let writer = {
            let terminals = self
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
            .terminals
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .remove(id);
        if let Some(mut inst) = instance {
            let _ = inst.killer.kill();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            buffer: VecDeque::new(),
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
            buffer: VecDeque::from(b"existing data".to_vec()),
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
}
