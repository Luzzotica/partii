//! Authentication actions for optional Supabase identity linking.

use crate::actions::ActionResult;
use crate::protocol::Identity;
use crate::state::ServerState;
use crate::stats;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Deserialize)]
struct AuthenticateParams {
    #[serde(rename = "accessToken")]
    access_token: String,
}

pub async fn authenticate(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: AuthenticateParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
    if p.access_token.trim().is_empty() {
        return Err("accessToken is required".to_string());
    }

    let user_id = stats::verify_access_token(&p.access_token).await?;
    let mut state = state.write().await;
    stats::set_identity_user_id(&mut state, identity, user_id);
    Ok(None)
}
