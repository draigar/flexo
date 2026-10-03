use crate::{
    types::{NetworkAddress, NetworkInterfaceInfo, NetworkKind},
    Result,
};
use if_addrs::IfAddr;
use std::collections::BTreeMap;
use std::net::IpAddr;

pub fn classify(name: &str) -> NetworkKind {
    let n = name.to_ascii_lowercase();

    // Wi-Fi / Wireless
    // macOS: en0, Linux: wl*, Windows: "wi-fi", "wireless"
    if n == "en0"
        || n.starts_with("wl")
        || n.contains("wifi")
        || n.contains("wi-fi")
        || n.contains("wlan")
        || n.contains("wireless")
    {
        return NetworkKind::Wifi;
    }

    // USB tethering
    // Linux: usb*, rndis*, Windows: "iphone usb"
    if n.contains("usb") || n.contains("rndis") || n.contains("iphone") {
        return NetworkKind::Usb;
    }

    // Bridge / virtual (Docker, VMware, Hyper-V, WSL)
    if n.starts_with("br")
        || n.contains("bridge")
        || n.contains("docker")
        || n.contains("vmnet")
        || n.contains("vethernet")  // Windows Hyper-V / WSL: "vEthernet (WSL)"
        || n.contains("virbr")      // Linux libvirt bridge
        || n.starts_with("vir")
    {
        return NetworkKind::Bridge;
    }

    // VPN / tunnel adapters – treat as Other so they're still usable but distinct
    if n.starts_with("tun")
        || n.starts_with("tap")
        || n.contains("vpn")
        || n.contains("nordlynx")
        || n.contains("proton")
        || n.contains("utun")   // macOS utun for VPN
    {
        return NetworkKind::Other;
    }

    // Ethernet
    // macOS: en1+, Linux: eth*, eno*, enp*, Windows: "ethernet", "local area connection"
    if n.starts_with("en")
        || n.starts_with("eth")
        || n.starts_with("eno")
        || n.starts_with("enp")
        || n.contains("ethernet")
        || n.contains("local area connection")
    {
        return NetworkKind::Ethernet;
    }

    NetworkKind::Other
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
