use crate::Result;
use std::path::{Path, PathBuf};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
};

pub fn part_file(directory: &Path, download_id: &str, block: usize) -> PathBuf {
    directory.join(format!("{download_id}.{block}.part"))
}

pub fn hedge_file(directory: &Path, download_id: &str, block: usize, attempt: usize) -> PathBuf {
    directory.join(format!("{download_id}.{block}.{attempt}.hedge"))
}

pub async fn reconcile(path: &Path, expected_max: u64) -> Result<u64> {
    match fs::metadata(path).await {
        Ok(metadata) if metadata.len() > expected_max => {
            fs::OpenOptions::new()
                .write(true)
                .open(path)
                .await?
                .set_len(expected_max)
                .await?;
            Ok(expected_max)
        }
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}

pub async fn merge_hedge(winner: &Path, destination: &Path) -> Result<()> {
    if winner == destination {
        return Ok(());
    }
    match fs::rename(winner, destination).await {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(winner, destination).await?;
            fs::remove_file(winner).await?;
            Ok(())
        }
    }
}

pub async fn assemble(parts: &[PathBuf], destination: &Path) -> Result<()> {
    assemble_with_progress(parts, destination, |_| {}).await
}

pub async fn assemble_with_progress(
    parts: &[PathBuf],
    destination: &Path,
    mut on_progress: impl FnMut(u64) + Send,
) -> Result<()> {
    if parts.is_empty() {
        fs::File::create(destination).await?;
        return Ok(());
    }

    // Fast-path: single block file can be renamed directly for instantaneous completion (0ms)
    if parts.len() == 1 {
        if let Ok(()) = fs::rename(&parts[0], destination).await {
            let total = fs::metadata(destination).await.map(|m| m.len()).unwrap_or(0);
            on_progress(total);
            return Ok(());
        }
    }

    let mut output = fs::File::create(destination).await?;
    let mut buffer = vec![0; 1024 * 1024]; // 1MB buffer for fast sequential disk I/O
    let mut total_assembled = 0_u64;

    for path in parts {
        let mut input = fs::File::open(path).await?;
        loop {
            let count = input.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            output.write_all(&buffer[..count]).await?;
            total_assembled += count as u64;
            on_progress(total_assembled);
        }
    }
    output.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fast_renames_single_part() {
        let temp_dir = std::env::temp_dir().join(format!("flexo_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).await.unwrap();
        let part = temp_dir.join("single.part");
        let dest = temp_dir.join("out.mp4");
        fs::write(&part, b"movie content bytes").await.unwrap();

        let mut progress_called = false;
        assemble_with_progress(&[part.clone()], &dest, |bytes| {
            if bytes == 19 {
                progress_called = true;
            }
        })
        .await
        .unwrap();

        assert!(!part.exists());
        assert!(dest.exists());
        assert_eq!(fs::read(&dest).await.unwrap(), b"movie content bytes");
        assert!(progress_called);
        let _ = fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn merges_multiple_parts_with_progress() {
        let temp_dir = std::env::temp_dir().join(format!("flexo_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).await.unwrap();
        let part0 = temp_dir.join("0.part");
        let part1 = temp_dir.join("1.part");
        let dest = temp_dir.join("combined.mp4");
        fs::write(&part0, b"part0_data_").await.unwrap();
        fs::write(&part1, b"part1_data").await.unwrap();

        let mut total_prog = 0;
        assemble_with_progress(&[part0, part1], &dest, |p| {
            total_prog = p;
        })
        .await
        .unwrap();

        assert!(dest.exists());
        assert_eq!(fs::read(&dest).await.unwrap(), b"part0_data_part1_data");
        assert_eq!(total_prog, 21);
        let _ = fs::remove_dir_all(&temp_dir).await;
    }
}

