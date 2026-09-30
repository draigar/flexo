use crate::{network::binding::connect_bound, EngineError, Result};
use std::{
    net::{IpAddr, SocketAddr},
    time::Instant,
};
use tokio::net::lookup_host;
use url::Url;

pub async fn tcp_latency_ms(
    url: &str,
    local: Option<IpAddr>,
    interface: Option<&str>,
) -> Result<u64> {
    let parsed = Url::parse(url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| EngineError::Message("URL has no host".into()))?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let target: SocketAddr = lookup_host((host, port))
        .await?
        .next()
        .ok_or_else(|| EngineError::Message("host did not resolve".into()))?;
    let started = Instant::now();
    connect_bound(target, local, interface).await?;
    Ok(started.elapsed().as_millis() as u64)
}
