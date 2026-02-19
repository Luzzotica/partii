//! CTF (Capture The Flag): flag spawn position from parsed map data (MapFlagLocation table).
//! Map is parsed once at lobby creation; flag locations are stored per lobby.

use spacetimedb::{ReducerContext, Table};
use spacetime_rapier::Vec3;

use crate::maps::map_flag_location;

/// Returns the spawn position near the team's flag for CTF, if the lobby's map defines it.
/// Uses MapFlagLocation table (filled when lobby is created from map JSON).
pub fn get_flag_spawn_position(ctx: &ReducerContext, lobby_id: u64, team: i32) -> Option<Vec3> {
    ctx.db
        .map_flag_location()
        .iter()
        .find(|loc| loc.lobby_id == lobby_id && loc.team == team)
        .map(|loc| Vec3::new(loc.position_x, 0.5, loc.position_z))
}
