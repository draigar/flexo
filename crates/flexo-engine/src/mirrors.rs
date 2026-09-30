use crate::{download::probe::probe_url, EngineError, Result};

pub async fn probe_and_verify(primary: &str, mirrors: &[String]) -> Result<Vec<String>> {
    let expected = probe_url(primary, None).await?;
    let mut verified = Vec::new();
    for mirror in mirrors {
        let probe = probe_url(mirror, None).await?;
        if expected.total_bytes.is_some() && probe.total_bytes != expected.total_bytes {
            return Err(EngineError::Message(format!(
                "mirror {mirror} is {:?} bytes; expected {:?}",
                probe.total_bytes, expected.total_bytes
            )));
        }
        if !probe.supports_ranges {
            return Err(EngineError::Message(format!(
                "mirror {mirror} does not support byte ranges"
            )));
        }
        verified.push(probe.final_url);
    }
    Ok(verified)
}
