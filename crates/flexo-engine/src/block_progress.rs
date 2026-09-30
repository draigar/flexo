use crate::types::BlockState;

pub fn advance_block(block: &mut BlockState, network_id: &str, position: u64) -> u64 {
    let length = block
        .range_end
        .map(|end| end - block.range_start + 1)
        .unwrap_or(u64::MAX);
    let next = position.min(length);
    let gained = next.saturating_sub(block.bytes_downloaded);
    if gained > 0 {
        block.bytes_downloaded = next;
        *block
            .bytes_by_interface
            .entry(network_id.to_owned())
            .or_default() += gained;
    }
    gained
}

pub fn retract_block(block: &mut BlockState, position: u64, blamed: Option<&str>) -> u64 {
    let removed = block.bytes_downloaded.saturating_sub(position);
    if removed == 0 {
        return 0;
    }
    let attributed: u64 = block.bytes_by_interface.values().sum();
    let mut excess = attributed.saturating_sub(position);
    let mut keys: Vec<_> = block.bytes_by_interface.keys().cloned().collect();
    keys.sort_by_key(|key| if Some(key.as_str()) == blamed { 0 } else { 1 });
    for key in keys {
        if excess == 0 {
            break;
        }
        let current = block.bytes_by_interface[&key];
        let taken = current.min(excess);
        excess -= taken;
        if current == taken {
            block.bytes_by_interface.remove(&key);
        } else {
            block.bytes_by_interface.insert(key, current - taken);
        }
    }
    block.bytes_downloaded = position;
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::BlockStatus;
    use std::collections::HashMap;

    fn block() -> BlockState {
        BlockState {
            index: 0,
            range_start: 100,
            range_end: Some(199),
            status: BlockStatus::Downloading,
            interface_id: None,
            bytes_downloaded: 0,
            bytes_by_interface: HashMap::new(),
        }
    }

    #[test]
    fn only_advances_frontier() {
        let mut b = block();
        assert_eq!(advance_block(&mut b, "wifi", 40), 40);
        assert_eq!(advance_block(&mut b, "usb", 20), 0);
        assert_eq!(advance_block(&mut b, "usb", 150), 60);
        assert_eq!(b.bytes_downloaded, 100);
        assert_eq!(b.bytes_by_interface.values().sum::<u64>(), 100);
    }

    #[test]
    fn retracts_blamed_first() {
        let mut b = block();
        advance_block(&mut b, "wifi", 40);
        advance_block(&mut b, "usb", 80);
        assert_eq!(retract_block(&mut b, 50, Some("usb")), 30);
        assert_eq!(b.bytes_by_interface["usb"], 10);
    }
}
