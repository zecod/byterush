//! Global bandwidth limiter shared by every connection (token bucket with debt).

use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Limiter {
    state: Mutex<State>,
}

struct State {
    bytes_per_sec: u64,
    allowance: f64,
    last: Instant,
}

impl Limiter {
    pub fn new(bytes_per_sec: u64) -> Self {
        Self { state: Mutex::new(State { bytes_per_sec, allowance: 0.0, last: Instant::now() }) }
    }

    pub fn set_rate(&self, bytes_per_sec: u64) {
        let mut s = self.state.lock().unwrap();
        s.bytes_per_sec = bytes_per_sec;
        s.allowance = 0.0;
        s.last = Instant::now();
    }

    /// Account for `n` received bytes, sleeping long enough to keep the average under the limit.
    pub async fn acquire(&self, n: usize) {
        let wait = {
            let mut s = self.state.lock().unwrap();
            if s.bytes_per_sec == 0 {
                return;
            }
            let rate = s.bytes_per_sec as f64;
            let now = Instant::now();
            s.allowance = (s.allowance + now.duration_since(s.last).as_secs_f64() * rate).min(rate);
            s.last = now;
            s.allowance -= n as f64;
            if s.allowance >= 0.0 { Duration::ZERO } else { Duration::from_secs_f64(-s.allowance / rate) }
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}
