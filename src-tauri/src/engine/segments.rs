//! Dynamic segmentation: a file starts split evenly across connections; when a connection
//! finishes its range it takes over the second half of the largest range still in progress.

use super::types::Segment;

/// Ranges smaller than this are never split further.
pub const MIN_SPLIT: u64 = 512 * 1024;

pub fn initial(size: u64, connections: u8) -> Vec<Segment> {
    let n = (connections.max(1) as u64).min((size / MIN_SPLIT).max(1));
    let chunk = size / n;
    (0..n)
        .map(|i| {
            let start = i * chunk;
            let end = if i == n - 1 { size } else { start + chunk };
            Segment::new(start, end)
        })
        .collect()
}

/// Give one connection something to do: an idle unfinished segment, otherwise split the busiest
/// segment in two. Returns the index of the claimed segment, or `None` when there is no work left
/// worth a new connection.
///
/// `cold_start` is roughly how long a new connection needs before it delivers at full speed
/// (seconds). Splitting saves half of what the busiest connection has left to do, so it only
/// pays when that is more than the cold start: on a far-away server, splitting the last few
/// megabytes swaps a fast connection for a slow new one and makes the end crawl.
pub fn claim(segments: &mut Vec<Segment>, cold_start: f64) -> Option<usize> {
    if let Some(i) = segments.iter().position(|s| !s.claimed && s.remaining() > 0) {
        segments[i].claimed = true;
        return Some(i);
    }
    let (i, remaining) = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.claimed && s.end != u64::MAX)
        .map(|(i, s)| (i, s.remaining()))
        .max_by_key(|&(_, r)| r)?;
    if remaining < 2 * MIN_SPLIT {
        return None;
    }
    // a connection that has gone quiet is not fast any more, whatever it measured before
    let fresh = segments[i].rate_at.is_some_and(|at| at.elapsed().as_secs_f64() < 1.0);
    let rate = if fresh { segments[i].rate as f64 } else { 0.0 };
    if rate > 0.0 && (remaining as f64 / rate) / 2.0 < cold_start {
        return None;
    }
    let mid = segments[i].pos() + remaining / 2;
    let mut stolen = Segment::new(mid, segments[i].end);
    stolen.claimed = true;
    segments[i].end = mid;
    segments.push(stolen);
    Some(segments.len() - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    #[test]
    fn initial_split_covers_file() {
        let segs = initial(100 * MB + 7, 8);
        assert_eq!(segs.len(), 8);
        assert_eq!(segs[0].start, 0);
        assert_eq!(segs.last().unwrap().end, 100 * MB + 7);
        for w in segs.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
        // tiny files use a single connection
        assert_eq!(initial(1000, 8).len(), 1);
        assert_eq!(initial(0, 8).len(), 1);
    }

    #[test]
    fn claim_then_steal() {
        let mut segs = initial(8 * MB, 2);
        assert_eq!(claim(&mut segs, 0.0), Some(0));
        assert_eq!(claim(&mut segs, 0.0), Some(1));
        // segment 0 finishes; a third claim splits segment 1 (4 MB left) in half
        segs[0].downloaded = segs[0].end - segs[0].start;
        segs[0].claimed = false;
        let i = claim(&mut segs, 0.0).unwrap();
        assert_eq!(i, 2);
        assert_eq!(segs[1].end, segs[2].start);
        assert_eq!(segs[2].end, 8 * MB);
        assert_eq!(segs[1].remaining(), 2 * MB);
        // nothing left that is big enough to split
        segs[1].downloaded = segs[1].end - segs[1].start - MB / 2;
        segs[2].downloaded = segs[2].end - segs[2].start - MB / 2;
        assert_eq!(claim(&mut segs, 0.0), None);
    }

    #[test]
    fn no_split_when_a_new_connection_would_not_catch_up() {
        let mut segs = initial(64 * MB, 2);
        claim(&mut segs, 0.0);
        claim(&mut segs, 0.0);
        segs[0].downloaded = segs[0].end - segs[0].start;
        segs[0].claimed = false;
        // 32 MB left at 5 MB/s: halving saves 3.2 s
        segs[1].rate = 5 * MB;
        segs[1].rate_at = Some(std::time::Instant::now());
        assert_eq!(claim(&mut segs, 4.0), None, "a 4 s cold start costs more than it saves");
        // the same connection stalled two seconds ago: take half of its range
        segs[1].rate_at = Some(std::time::Instant::now() - std::time::Duration::from_secs(2));
        assert_eq!(claim(&mut segs, 4.0), Some(2), "a stalled connection gets help");
    }

    #[test]
    fn split_when_a_new_connection_catches_up() {
        let mut segs = initial(64 * MB, 2);
        claim(&mut segs, 0.0);
        claim(&mut segs, 0.0);
        segs[0].downloaded = segs[0].end - segs[0].start;
        segs[0].claimed = false;
        segs[1].rate = 5 * MB;
        segs[1].rate_at = Some(std::time::Instant::now());
        assert_eq!(claim(&mut segs, 1.0), Some(2), "a 1 s cold start is worth 3.2 s saved");
    }
}
