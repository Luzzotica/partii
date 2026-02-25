//! CTF flag state

#[derive(Clone, Debug)]
pub enum FlagState {
    /// At base; position is from MapFlagLocation.
    AtBase {
        position_x: f32,
        position_y: f32,
        position_z: f32,
    },
    /// Carried by a player.
    Carried {
        carrier_id: String,
    },
    /// Dropped on the ground; has a physics body.
    Dropped {
        rigid_body_id: u64,
        position_x: f32,
        position_y: f32,
        position_z: f32,
    },
}

#[derive(Clone, Debug)]
pub struct FlagData {
    pub lobby_id: u64,
    pub team: i32,
    pub state: FlagState,
}
