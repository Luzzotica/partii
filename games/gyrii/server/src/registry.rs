//! Connection registry for broadcasting deltas to clients

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

pub type Registry = Arc<RwLock<ConnectionRegistry>>;

pub struct ConnectionRegistry {
    /// identity -> (lobby_id if in a lobby, sender for server->client messages)
    conns: HashMap<String, (Option<u64>, mpsc::UnboundedSender<String>)>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            conns: HashMap::new(),
        }
    }

    pub fn register(&mut self, identity: String) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.conns.insert(identity, (None, tx));
        rx
    }

    pub fn set_lobby(&mut self, identity: &str, lobby_id: Option<u64>) {
        if let Some((lobby, _)) = self.conns.get_mut(identity) {
            *lobby = lobby_id;
        }
    }

    pub fn get_lobby(&self, identity: &str) -> Option<u64> {
        self.conns.get(identity).and_then(|(lobby, _)| *lobby)
    }

    pub fn unregister(&mut self, identity: &str) {
        self.conns.remove(identity);
    }

    /// Send message to all clients in the given lobby
    pub fn broadcast_to_lobby(&self, lobby_id: u64, msg: &str) {
        for (_, (lobby, tx)) in self.conns.iter() {
            if *lobby == Some(lobby_id) {
                let _ = tx.send(msg.to_string());
            }
        }
    }

    /// Send message to ALL connected clients (e.g. lobby list updates)
    pub fn broadcast_to_all(&self, msg: &str) {
        for (_, (_, tx)) in self.conns.iter() {
            let _ = tx.send(msg.to_string());
        }
    }
}
