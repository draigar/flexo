use crate::{EngineError, Result};
use reqwest::{Client, Method, RequestBuilder, Response};
use std::{
    error::Error,
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use tokio::net::TcpStream;

pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Flexo/1.0";

pub fn client_for(local_address: Option<IpAddr>) -> Result<Client> {
    let mut builder = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(30))
        // Do not set a fixed total request timeout (e.g. 120s) because large movie downloads stream over long durations.
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .redirect(reqwest::redirect::Policy::limited(10));
    if let Some(address) = local_address {
        builder = builder.local_address(address);
    }
    Ok(builder.build()?)
}

/// GET that prefers a bound interface, then retries on the default route if binding fails.
pub async fn send_get(
    url: &str,
    local_address: Option<IpAddr>,
    configure: impl Fn(RequestBuilder) -> RequestBuilder,
) -> Result<Response> {
    let build = |address: Option<IpAddr>| -> Result<RequestBuilder> {
        let req = client_for(address)?
            .request(Method::GET, url)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::ACCEPT, "*/*")
            .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        Ok(configure(req))
    };

    match build(local_address)?.send().await {
        Ok(response) => Ok(response),
        Err(bound_error) if local_address.is_some() => {
            tracing::warn!(
                error = %bound_error,
                ?local_address,
                "bound request failed; retrying on the default route"
            );
            match build(None)?.send().await {
                Ok(response) => Ok(response),
                Err(fallback_error) => Err(EngineError::Message(format!(
                    "could not reach {url} via the selected network ({}); \
                     default route also failed ({})",
                    root_message(&bound_error),
                    root_message(&fallback_error)
                ))),
            }
        }
        Err(error) => Err(explain_http(url, error)),
    }
}

fn root_message(error: &reqwest::Error) -> String {
    let mut current: &dyn Error = error;
    while let Some(source) = current.source() {
        current = source;
    }
    current.to_string()
}

fn explain_http(url: &str, error: reqwest::Error) -> EngineError {
    let detail = if error.is_timeout() {
        "timed out connecting".to_owned()
    } else if error.is_connect() {
        format!("could not connect ({})", root_message(&error))
    } else {
        root_message(&error)
    };
    EngineError::Message(format!("HTTP error for {url}: {detail}"))
}

pub async fn connect_bound(
    target: SocketAddr,
    local_address: Option<IpAddr>,
    interface_name: Option<&str>,
) -> Result<TcpStream> {
    let domain = if target.is_ipv4() {
        socket2::Domain::IPV4
    } else {
        socket2::Domain::IPV6
    };
    let socket = socket2::Socket::new(domain, socket2::Type::STREAM, Some(socket2::Protocol::TCP))?;
    socket.set_nonblocking(true)?;
    if let Some(address) = local_address {
        socket.bind(&SocketAddr::new(address, 0).into())?;
    }
    #[cfg(target_os = "linux")]
    if let Some(name) = interface_name {
        socket.bind_device(Some(name.as_bytes()))?;
    }
    #[cfg(not(target_os = "linux"))]
    let _ = interface_name;
    match socket.connect(&target.into()) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
        Err(error) => return Err(error.into()),
    }
    let stream = TcpStream::from_std(socket.into())?;
    tokio::time::timeout(Duration::from_secs(10), stream.writable())
        .await
        .map_err(|_| EngineError::Message("TCP connection timed out".into()))??;
    if let Some(error) = stream.take_error()? {
        return Err(error.into());
    }
    Ok(stream)
}
