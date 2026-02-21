//! Server configuration from environment

pub fn port() -> u16 {
    std::env::var("GYRII_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4000)
}

pub fn host() -> String {
    std::env::var("GYRII_SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string())
}
