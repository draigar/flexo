use crate::{types::WidgetSnapshot, Result};
use std::path::Path;
use tokio::fs;

pub async fn write_snapshot(path: &Path, snapshot: &WidgetSnapshot) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(snapshot)?).await?;
    fs::rename(temporary, path).await?;
    Ok(())
}

pub fn write_snapshot_sync(path: &Path, snapshot: &WidgetSnapshot) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(snapshot)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}
