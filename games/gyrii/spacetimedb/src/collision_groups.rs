//! Collision group bits for Rapier. Adjust here to change which layers interact.
//! Bullets (sensor) only generate events with groups in their filter.
//! Two bodies interact if (A.memberships & B.filter) != 0 && (B.memberships & A.filter) != 0.

pub const GROUP_BULLET: u32 = 1 << 0;  // 1
pub const GROUP_PLAYER: u32 = 1 << 1;  // 2
pub const GROUP_WALL: u32 = 1 << 2;    // 4
pub const GROUP_FLOOR: u32 = 1 << 3;   // 8
pub const GROUP_GRENADE: u32 = 1 << 4; // 16
