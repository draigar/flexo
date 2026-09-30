use crate::{
    types::{NetworkAddress, NetworkInterfaceInfo, NetworkKind},
    Result,
};
use if_addrs::IfAddr;
use std::collections::BTreeMap;
use std::net::IpAddr;

pub fn classify(name: &str) -> NetworkKind {
    let name = name.to_ascii_lowercase();
    if name.starts_with("wl") || name.contains("wifi") || name.contains("wlan") || name == "en0" {
        NetworkKind::Wifi
    } else if name.contains("usb") || name.contains("rndis") || name.contains("iphone") {
        NetworkKind::Usb
    } else if name.starts_with("br") || name.contains("bridge") {
        NetworkKind::Bridge
    } else if name.starts_with("en") || name.starts_with("eth") {
        NetworkKind::Ethernet
    } else {
        NetworkKind::Other
    }
}

fn is_usable_address(address: IpAddr) -> bool {
    if address.is_loopback() || address.is_unspecified() {
        return false;
    }
    match address {
        IpAddr::V4(v4) => !v4.is_link_local() && !v4.is_broadcast() && !v4.is_documentation(),
        // Drop link-local (fe80::/10) — same filter Plexo used.
        IpAddr::V6(v6) => !v6.is_unicast_link_local(),
    }
}

pub fn list_active_interfaces() -> Result<Vec<NetworkInterfaceInfo>> {
    let mut grouped: BTreeMap<String, Vec<NetworkAddress>> = BTreeMap::new();
    for interface in if_addrs::get_if_addrs()? {
        let address = interface.ip();
        if !is_usable_address(address) {
            continue;
        }
        let (family, netmask, subnet) = match interface.addr {
            IfAddr::V4(v4) => {
                let ip = u32::from(v4.ip);
                let mask = u32::from(v4.netmask);
                (
                    4,
                    Some(v4.netmask.to_string()),
                    Some(format!("{}/{}", std::net::Ipv4Addr::from(ip & mask), mask.count_ones())),
                )
            }
            IfAddr::V6(v6) => (6, Some(v6.netmask.to_string()), None),
        };
        grouped
            .entry(interface.name)
            .or_default()
            .push(NetworkAddress {
                address: address.to_string(),
                family,
                netmask,
                subnet,
            });
    }
    Ok(grouped
        .into_iter()
        .filter(|(_, addresses)| !addresses.is_empty())
        .map(|(device, addresses)| NetworkInterfaceInfo {
            id: device.clone(),
            display_name: device.clone(),
            kind: classify(&device),
            device,
            addresses,
            mac: None,
        })
        .collect())
}
