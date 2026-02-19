// Gyrii - Multiplayer Ball Shooter Server Module
// Built with SpacetimeDB and spacetime_rapier

#![feature(import_trait_associated_functions)]
#![allow(hidden_glob_reexports)]

mod collision_groups;
mod constants;
mod ctf;
mod game;
mod lobby;
mod map_parser;
mod maps;
mod player;
mod weapons;

pub use ctf::*;
pub use game::*;
pub use lobby::*;
pub use map_parser::*;
pub use maps::*;
pub use player::*;
pub use weapons::*;
