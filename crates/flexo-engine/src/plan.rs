use crate::types::NetworkKind;
use std::hash::Hash;

pub const DEFAULT_MAX_BLOCK_BYTES: u64 = 8 * 1024 * 1024;
pub const MIN_BLOCK_BYTES: u64 = 1024 * 1024;
pub const MAX_BLOCKS: u64 = 4096;
pub const MAX_STREAMS_PER_NETWORK: usize = 8;
pub const MAX_STREAMS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPlan {
    pub block_size_bytes: u64,
    pub block_count: usize,
    pub stream_networks: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct PlanRequest {
    pub total_bytes: u64,
    pub splittable: bool,
    pub network_count: usize,
    pub streams_per_network: usize,
    pub max_block_bytes: Option<u64>,
}

pub fn interleave<T: Clone, K: Eq + Hash>(items: &[T], group_of: impl Fn(&T) -> K) -> Vec<T> {
    let mut keys = Vec::new();
    let mut lanes: Vec<Vec<T>> = Vec::new();
    for item in items {
        let key = group_of(item);
        if let Some(index) = keys.iter().position(|existing| *existing == key) {
            lanes[index].push(item.clone());
        } else {
            keys.push(key);
            lanes.push(vec![item.clone()]);
        }
    }
    let mut out = Vec::with_capacity(items.len());
    let mut round = 0;
    while out.len() < items.len() {
        for lane in &lanes {
            if let Some(item) = lane.get(round) {
                out.push(item.clone());
            }
        }
        round += 1;
    }
    out
}

pub fn resolve_auto_block_bytes(kinds: &[NetworkKind]) -> u64 {
    if !kinds.is_empty() && kinds.iter().all(|kind| kind == &kinds[0]) {
        32 * 1024 * 1024
    } else {
        DEFAULT_MAX_BLOCK_BYTES
    }
}

pub fn plan_download(req: PlanRequest) -> DownloadPlan {
    let networks = req.network_count.max(1);
    if !req.splittable || req.total_bytes == 0 {
        return DownloadPlan {
            block_size_bytes: req.total_bytes,
            block_count: 1,
            stream_networks: vec![0],
        };
    }
    let max = req.max_block_bytes.unwrap_or_else(|| {
        if req.total_bytes >= 2 * 1024 * 1024 * 1024 {
            128 * 1024 * 1024
        } else if req.total_bytes >= 500 * 1024 * 1024 {
            64 * 1024 * 1024
        } else {
            32 * 1024 * 1024
        }
    }).max(1);
    let requested = req.streams_per_network.clamp(1, MAX_STREAMS_PER_NETWORK);
    let target = networks * (requested * 2).max(4);
    let mut block_size = req
        .total_bytes
        .div_ceil(target as u64)
        .clamp(MIN_BLOCK_BYTES.min(max), max);
    block_size = block_size.max(req.total_bytes.div_ceil(MAX_BLOCKS));
    let block_count = req.total_bytes.div_ceil(block_size) as usize;
    let per_network = requested.min(block_count.div_ceil(networks)).max(1);
    let grouped: Vec<_> = (0..networks)
        .flat_map(|network| std::iter::repeat_n(network, per_network))
        .collect();
    DownloadPlan {
        block_size_bytes: block_size,
        block_count,
        stream_networks: interleave(&grouped, |network| *network)
            .into_iter()
            .take(MAX_STREAMS)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interleaves_stably() {
        assert_eq!(interleave(&[0, 0, 1, 1, 1], |x| *x), vec![0, 1, 0, 1, 1]);
    }

    #[test]
    fn unsplittable_is_one_block_and_stream() {
        let plan = plan_download(PlanRequest {
            total_bytes: 50,
            splittable: false,
            network_count: 2,
            streams_per_network: 8,
            max_block_bytes: None,
        });
        assert_eq!(
            plan,
            DownloadPlan {
                block_size_bytes: 50,
                block_count: 1,
                stream_networks: vec![0]
            }
        );
    }

    #[test]
    fn respects_custom_max_and_interleaves() {
        let plan = plan_download(PlanRequest {
            total_bytes: 64 * 1024 * 1024,
            splittable: true,
            network_count: 2,
            streams_per_network: 2,
            max_block_bytes: Some(4 * 1024 * 1024),
        });
        assert!(plan.block_size_bytes <= 4 * 1024 * 1024);
        assert_eq!(plan.stream_networks, vec![0, 1, 0, 1]);
    }
}
