//! Player state types

use serde::{Deserialize, Serialize};

use crate::state::Vec3;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum WeaponType {
    Smg,
    DualMachineGun,
    ChainGun,
    PhotonRifle,
    Bazooka,
    Flamethrower,
    Shotgun,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum SecondaryType {
    PopupKnives,
    BubbleShield,
    SelfDestructNuke,
    PopupHammers,
    Dash,
}

#[derive(Clone, Debug)]
pub struct Player {
    pub identity: String,
    pub name: String,
    pub lobby_id: u64,
    pub rigid_body_id: u64,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub spawn_x: f32,
    pub spawn_y: f32,
    pub spawn_z: f32,
    pub health: i32,
    pub max_health: i32,
    pub is_alive: bool,
    pub team: i32,
    pub kills: i32,
    pub deaths: i32,
    pub flag_captures: i32,
    pub weapon: WeaponType,
    pub secondary: SecondaryType,
    pub grenades: i32,
    pub molotovs: i32,
    pub color_r: f32,
    pub color_g: f32,
    pub color_b: f32,
    pub design_id: u8,
    pub secondary_color_r: f32,
    pub secondary_color_g: f32,
    pub secondary_color_b: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub velocity_z: f32,
    /// Monotonic server-authored snapshot id for position/velocity reconciliation.
    pub server_snapshot_id: u64,
    pub input_x: f32,
    pub input_z: f32,
    pub aim_x: f32,
    pub aim_z: f32,
    pub is_shooting: bool,
    pub last_shot_at: i64,
    pub last_grenade_thrown_at: i64,
    pub last_impulse_x: f32,
    pub last_impulse_y: f32,
    pub last_impulse_z: f32,
    pub last_impulse_time: i64,
    /// When photon rifle charge started (micros); None when not holding.
    pub photon_rifle_charge_started_at: Option<i64>,
    /// CTF: team of flag being carried (None = not carrying).
    pub held_flag_team: Option<i32>,
    /// When PopupHammers used: micros until shooting/grenade allowed again. 0 = not in cooldown.
    pub secondary_forced_cooldown_until_micros: i64,
    /// When any secondary ability was last used (micros); for ability cooldown.
    pub last_secondary_used_at: i64,
}

impl Player {
    pub fn position(&self) -> Vec3 {
        Vec3::new(self.position_x, self.position_y, self.position_z)
    }

    pub fn set_position(&mut self, pos: Vec3) {
        self.position_x = pos.x;
        self.position_y = pos.y;
        self.position_z = pos.z;
    }
}
