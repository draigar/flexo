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
    let mut output = fs::File::create(destination).await?;
    let mut buffer = vec![0; 128 * 1024];
    for path in parts {
        let mut input = fs::File::open(path).await?;
        loop {
            let count = input.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            output.write_all(&buffer[..count]).await?;
        }
    }
    output.flush().await?;
    Ok(())
}
