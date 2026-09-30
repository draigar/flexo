use flexo_engine::{DownloadState, DownloadStatus};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{path::Path, sync::Arc};

#[derive(Clone)]
pub struct HistoryDb(Arc<Mutex<Connection>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub destination_path: String,
    pub total_bytes: u64,
    pub started_at: u64,
    pub completed_at: u64,
}

impl HistoryDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let conn = Connection::open(path).map_err(|error| error.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                file_name TEXT NOT NULL,
                destination_path TEXT NOT NULL,
                total_bytes INTEGER NOT NULL,
                started_at INTEGER NOT NULL,
                completed_at INTEGER NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }

    /// Records a finished download once. Later updates for the same id are ignored.
    pub fn record(&self, state: &DownloadState) -> bool {
        if state.status != DownloadStatus::Completed {
            return false;
        }
        let completed_at = state.completed_at.unwrap_or(state.started_at);
        let conn = self.0.lock();
        match conn.execute(
            "INSERT OR IGNORE INTO downloads
                (id, url, file_name, destination_path, total_bytes, started_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                state.id,
                state.url,
                state.file_name,
                state.destination_path.to_string_lossy(),
                state.total_bytes as i64,
                state.started_at as i64,
                completed_at as i64,
            ],
        ) {
            Ok(changed) => changed > 0,
            Err(error) => {
                eprintln!("Flexo could not record download history: {error}");
                false
            }
        }
    }

    pub fn list(&self) -> Result<Vec<DownloadRecord>, String> {
        let conn = self.0.lock();
        let mut statement = conn
            .prepare(
                "SELECT id, url, file_name, destination_path, total_bytes, started_at, completed_at
                 FROM downloads
                 ORDER BY completed_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(DownloadRecord {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    file_name: row.get(2)?,
                    destination_path: row.get(3)?,
                    total_bytes: row.get::<_, i64>(4)? as u64,
                    started_at: row.get::<_, i64>(5)? as u64,
                    completed_at: row.get::<_, i64>(6)? as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}
