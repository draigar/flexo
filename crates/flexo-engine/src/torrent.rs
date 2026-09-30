use crate::{types::DownloadState, EngineError, Result};
use async_trait::async_trait;
use std::path::Path;
use std::sync::Arc;
use url::Url;

#[async_trait]
pub trait TorrentEngine: Send + Sync {
    async fn start(&self, source: &str, destination: &Path) -> Result<String>;
    async fn pause(&self, id: &str) -> Result<()>;
    async fn cancel(&self, id: &str) -> Result<()>;
    async fn state(&self, id: &str) -> Result<DownloadState>;
}

pub fn parse_magnet_info_hash(magnet: &str) -> Result<String> {
    let url = Url::parse(magnet)?;
    if url.scheme() != "magnet" {
        return Err(EngineError::Message("expected a magnet URI".into()));
    }
    url.query_pairs()
        .find_map(|(key, value)| {
            (key == "xt")
                .then(|| value.strip_prefix("urn:btih:").map(str::to_owned))
                .flatten()
        })
        .ok_or_else(|| EngineError::Message("magnet URI has no BitTorrent info hash".into()))
}

pub fn default_engine() -> Arc<dyn TorrentEngine> {
    #[cfg(feature = "torrent")]
    {
        Arc::new(RqbitTorrent)
    }
    #[cfg(not(feature = "torrent"))]
    {
        Arc::new(SimulatedTorrent)
    }
}

pub struct SimulatedTorrent;

#[async_trait]
impl TorrentEngine for SimulatedTorrent {
    async fn start(&self, source: &str, _destination: &Path) -> Result<String> {
        if source.starts_with("magnet:") {
            let _ = parse_magnet_info_hash(source)?;
        }
        Err(EngineError::Message(
            "torrent support requires building flexo-engine with --features torrent (librqbit)".into(),
        ))
    }
    async fn pause(&self, _id: &str) -> Result<()> {
        Err(disabled())
    }
    async fn cancel(&self, _id: &str) -> Result<()> {
        Err(disabled())
    }
    async fn state(&self, _id: &str) -> Result<DownloadState> {
        Err(disabled())
    }
}

fn disabled() -> EngineError {
    EngineError::Message(
        "torrent support requires building flexo-engine with --features torrent (librqbit)".into(),
    )
}

/// Placeholder for the librqbit-backed engine. Enable with `--features torrent`.
#[cfg(feature = "torrent")]
pub struct RqbitTorrent;

#[cfg(feature = "torrent")]
#[async_trait]
impl TorrentEngine for RqbitTorrent {
    async fn start(&self, source: &str, destination: &Path) -> Result<String> {
        // librqbit integration point: create a session, add magnet/.torrent, bind
        // peer sockets per selected adapter, and map piece progress to DownloadState.
        let _ = (source, destination);
        Err(EngineError::Message(
            "librqbit session wiring is not compiled into this build yet".into(),
        ))
    }
    async fn pause(&self, _id: &str) -> Result<()> {
        Err(disabled())
    }
    async fn cancel(&self, _id: &str) -> Result<()> {
        Err(disabled())
    }
    async fn state(&self, _id: &str) -> Result<DownloadState> {
        Err(disabled())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_magnet_info_hash() {
        let hash = parse_magnet_info_hash(
            "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo",
        )
        .unwrap();
        assert_eq!(hash, "0123456789abcdef0123456789abcdef01234567");
    }
}
