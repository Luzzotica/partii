//! The partii connection engine. One implementation of rooms, signaling,
//! peer links and recovery, used natively by games and compiled to wasm for
//! web pages (docs/platform/ENGINE.md).
pub mod arq;
pub mod link;
pub mod core;
#[cfg(all(feature = "native", not(target_arch = "wasm32")))]
pub mod native;
#[cfg(all(feature = "native", not(target_arch = "wasm32")))]
pub use native::Engine;
pub use core::{Config, Event, Member, Room, BROADCAST};
pub use link::PathId;
#[cfg(target_arch = "wasm32")]
pub mod web;
#[cfg(target_arch = "wasm32")]
pub use web::Engine;
