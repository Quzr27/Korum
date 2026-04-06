use std::sync::Mutex;

pub struct QuitGuardState {
    allow_exit: Mutex<bool>,
}

impl QuitGuardState {
    pub fn new() -> Self {
        Self {
            allow_exit: Mutex::new(false),
        }
    }

    pub fn allow_next_exit(&self) {
        if let Ok(mut allow_exit) = self.allow_exit.lock() {
            *allow_exit = true;
        }
    }

    pub fn consume_exit_allowance(&self) -> bool {
        match self.allow_exit.lock() {
            Ok(mut allow_exit) => std::mem::take(&mut *allow_exit),
            Err(_) => false,
        }
    }
}
