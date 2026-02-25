//! Fixed-step game loop at 60 Hz. Physics and player input use PHYSICS_TICK_DT.
//!
//! Timer system:
//! - Server: sleep until next_tick, then run all phases. Each tick uses dt = PHYSICS_TICK_DT.
//! - Client: accumulate real elapsed time in physicsAccumulator; step physics in fixed
//!   PHYSICS_TICK_DT chunks. Input is applied once per physics step.

mod phases;

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::registry::Registry;
use crate::state::ServerState;

pub use phases::*;

/// 60 Hz tick interval; must match PHYSICS_TICK_DT.
const TICK_INTERVAL: Duration = Duration::from_micros(1_000_000 / 60);

/// Spawn the game loop task. Runs at 1/PHYSICS_TICK_DT Hz (60 Hz).
pub fn spawn_game_loop(state: Arc<RwLock<ServerState>>, registry: Registry) {
    tokio::spawn(async move {
        let mut next_tick = Instant::now();
        let mut tick: u64 = 0;
        loop {
            next_tick += TICK_INTERVAL;
            tokio::time::sleep_until(next_tick.into()).await;

            let mut state = match state.try_write() {
                Ok(s) => s,
                Err(_) => continue,
            };

            // Phase: ApplyInput
            phases::apply_input(&mut state);

            // Phase: Secondary actions (hammers, dash) - before physics so dash impulse is integrated
            let mut secondary_kill_events = phases::process_secondary_actions(&mut state);

            // Phase: PhysicsStep
            let all_collisions = phases::physics_step(&mut state);

            // Phase: Collisions (projectiles, launchers, expiry, grenades, photon beams)
            let mut all_kill_events = phases::process_collisions(&mut state, &all_collisions);
            all_kill_events.append(&mut secondary_kill_events);

            // Phase: Win conditions (FFA/TDM)
            let mut game_ended_messages = phases::check_win_conditions(&mut state);

            // Phase: Combat (firing)
            let mut all_shot_events = phases::combat_phase(&mut state, tick);

            // Phase: Sync positions from physics
            phases::sync_positions(&mut state);

            // Phase: Fall death
            phases::fall_death(&mut state, &mut all_kill_events);

            tick += 1;

            // Phase: CTF win condition
            phases::check_ctf_win(&mut state, &mut game_ended_messages);

            // Phase: Sync (broadcast deltas, game ended, round restarts)
            phases::sync_broadcast(
                &mut state,
                &registry,
                tick,
                &all_shot_events,
                &all_kill_events,
                &game_ended_messages,
            ).await;
        }
    });
}
