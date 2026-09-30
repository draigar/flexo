use crate::types::{BlockState, BlockStatus, ChunkState, ChunkStatus};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkKind {
    Primary,
    Hedge,
}

#[derive(Debug, Clone)]
pub struct AttemptView {
    pub kind: WorkKind,
    pub stream_id: usize,
    pub network_id: String,
    pub started_at_ms: u64,
}

pub struct SchedulerState<'a> {
    pub blocks: &'a [BlockState],
    pub streams: &'a [ChunkState],
    pub attempts: &'a HashMap<usize, Vec<AttemptView>>,
    pub avoid: &'a HashMap<usize, String>,
    pub hedges_used: &'a HashMap<usize, usize>,
}

#[derive(Debug, Clone, Copy)]
pub struct SchedulerPolicy {
    pub hedge_after_ms: u64,
    pub max_hedges_per_block: usize,
}

pub struct Requester<'a> {
    pub id: usize,
    pub network_id: &'a str,
}

#[derive(Debug, Clone)]
pub struct Work {
    pub kind: WorkKind,
    pub block: BlockState,
    pub mirror_url: Option<String>,
    pub source_index: Option<usize>,
}

pub fn pick_work(
    state: &SchedulerState<'_>,
    who: Requester<'_>,
    now_ms: u64,
    policy: SchedulerPolicy,
) -> Option<Work> {
    let other_free = state.streams.iter().any(|stream| {
        stream.interface_id != who.network_id && stream.status == ChunkStatus::Pending
    });
    if let Some(block) = state.blocks.iter().find(|block| {
        block.status == BlockStatus::Pending
            && !(other_free
                && state
                    .avoid
                    .get(&block.index)
                    .is_some_and(|id| id == who.network_id))
    }) {
        return Some(Work {
            kind: WorkKind::Primary,
            block: block.clone(),
            mirror_url: None,
            source_index: None,
        });
    }
    if state
        .blocks
        .iter()
        .any(|block| block.status == BlockStatus::Pending)
    {
        return None;
    }

    let mut best: Option<(&BlockState, f64)> = None;
    for (&index, attempts) in state.attempts {
        let Some(block) = state.blocks.get(index).filter(|block| {
            block.index == index
                && block.range_end.is_some()
                && block.status == BlockStatus::Downloading
        }) else {
            continue;
        };
        if attempts.len() != 1 || attempts[0].kind != WorkKind::Primary {
            continue;
        }
        let holder = &attempts[0];
        if holder.stream_id == who.id
            || state.hedges_used.get(&index).copied().unwrap_or(0) >= policy.max_hedges_per_block
            || state
                .avoid
                .get(&index)
                .is_some_and(|id| id == who.network_id)
            || now_ms.saturating_sub(holder.started_at_ms) < policy.hedge_after_ms
        {
            continue;
        }
        let remaining = block.range_end.unwrap() - block.range_start + 1 - block.bytes_downloaded;
        if remaining == 0 {
            continue;
        }
        let speed = state
            .streams
            .iter()
            .find(|stream| stream.id == holder.stream_id)
            .map(|stream| stream.speed_bytes_per_sec)
            .unwrap_or(0);
        let eta = if speed == 0 {
            f64::INFINITY
        } else {
            remaining as f64 / speed as f64 * 1000.0
        };
        if eta < policy.hedge_after_ms as f64 {
            continue;
        }
        let other_network_free = state.streams.iter().any(|stream| {
            stream.interface_id != holder.network_id
                && stream.status == ChunkStatus::Pending
                && state
                    .avoid
                    .get(&index)
                    .is_none_or(|id| id != &stream.interface_id)
        });
        if holder.network_id == who.network_id && other_network_free {
            continue;
        }
        if best.as_ref().is_none_or(|(_, best_eta)| eta > *best_eta) {
            best = Some((block, eta));
        }
    }
    best.map(|(block, _)| Work {
        kind: WorkKind::Hedge,
        block: block.clone(),
        mirror_url: None,
        source_index: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn block(index: usize, status: BlockStatus) -> BlockState {
        BlockState {
            index,
            range_start: index as u64 * 100,
            range_end: Some(index as u64 * 100 + 99),
            status,
            interface_id: None,
            bytes_downloaded: 0,
            bytes_by_interface: HashMap::new(),
        }
    }
    fn stream(id: usize, network: &str, status: ChunkStatus, speed: u64) -> ChunkState {
        ChunkState {
            id,
            interface_id: network.into(),
            interface_label: network.into(),
            interface_kind: NetworkKind::Other,
            range_start: 0,
            range_end: None,
            bytes_downloaded: 0,
            status,
            speed_bytes_per_sec: speed,
            error: None,
            retry_count: 0,
            current_block_index: None,
            hedge: None,
        }
    }

    #[test]
    fn primary_precedes_hedge_and_honors_avoid() {
        let blocks = vec![block(0, BlockStatus::Pending)];
        let streams = vec![
            stream(0, "a", ChunkStatus::Pending, 0),
            stream(1, "b", ChunkStatus::Pending, 0),
        ];
        let avoid = HashMap::from([(0, "a".into())]);
        let state = SchedulerState {
            blocks: &blocks,
            streams: &streams,
            attempts: &HashMap::new(),
            avoid: &avoid,
            hedges_used: &HashMap::new(),
        };
        assert!(pick_work(
            &state,
            Requester {
                id: 0,
                network_id: "a"
            },
            0,
            SchedulerPolicy {
                hedge_after_ms: 1000,
                max_hedges_per_block: 1
            }
        )
        .is_none());
    }

    #[test]
    fn hedges_slow_last_block() {
        let blocks = vec![block(0, BlockStatus::Downloading)];
        let streams = vec![
            stream(0, "a", ChunkStatus::Downloading, 1),
            stream(1, "b", ChunkStatus::Pending, 0),
        ];
        let attempts = HashMap::from([(
            0,
            vec![AttemptView {
                kind: WorkKind::Primary,
                stream_id: 0,
                network_id: "a".into(),
                started_at_ms: 0,
            }],
        )]);
        let avoid: HashMap<usize, String> = HashMap::new();
        let hedges: HashMap<usize, usize> = HashMap::new();
        let state = SchedulerState {
            blocks: &blocks,
            streams: &streams,
            attempts: &attempts,
            avoid: &avoid,
            hedges_used: &hedges,
        };
        assert_eq!(
            pick_work(
                &state,
                Requester {
                    id: 1,
                    network_id: "b"
                },
                2000,
                SchedulerPolicy {
                    hedge_after_ms: 1000,
                    max_hedges_per_block: 1
                }
            )
            .unwrap()
            .kind,
            WorkKind::Hedge
        );
    }
}
