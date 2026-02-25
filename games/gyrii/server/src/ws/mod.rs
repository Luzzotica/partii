//! WebSocket message handling: decode client messages, build action responses

mod action_response;
mod client_decode;

pub use action_response::{build_action_responses, ResponseTarget};
pub use client_decode::decode_client_message;