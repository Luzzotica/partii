//! Parse map JSON for lobby creation

use serde::Deserialize;

use crate::state::MapId;

#[derive(Deserialize)]
pub struct MapJson {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub walls: Vec<WallCell>,
    #[serde(rename = "floorGrid", default)]
    pub floor_grid: Option<Vec<Vec<u8>>>,
    #[serde(rename = "spawnPoints", default)]
    pub spawn_points: Vec<SpawnPointJson>,
    #[serde(rename = "flagLocations", default)]
    pub flag_locations: Vec<FlagLocationJson>,
    #[serde(default)]
    pub launchers: Vec<LauncherJson>,
}

#[derive(Deserialize)]
pub struct WallCell {
    pub x: u32,
    pub y: u32,
    pub height: i32,
}

#[derive(Deserialize)]
pub struct SpawnPointJson {
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub team: Option<i32>,
}

#[derive(Deserialize)]
pub struct FlagLocationJson {
    pub x: f32,
    pub y: f32,
    pub team: i32,
}

#[derive(Deserialize)]
pub struct LauncherJson {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    #[serde(rename = "directionX")]
    pub direction_x: f32,
    #[serde(rename = "directionY")]
    pub direction_y: f32,
    #[serde(rename = "directionZ")]
    pub direction_z: f32,
    pub force: f32,
}

pub struct ParsedMap {
    pub width: u32,
    pub height: u32,
    pub walls: Vec<WallCell>,
    pub floor_grid: Option<Vec<Vec<u8>>>,
    pub spawn_points: Vec<(f32, f32, Option<i32>)>,
    pub flag_locations: Vec<(f32, f32, i32)>,
    pub launchers: Vec<(f32, f32, f32, f32, f32, f32, f32)>, // (x, y, radius, dir_x, dir_y, dir_z, force)
}

pub fn grid_to_world_x(gx: u32, map_width: u32) -> f32 {
    (gx as f32) - (map_width as f32) / 2.0 + 0.5
}

pub fn grid_to_world_z(gy: u32, map_height: u32) -> f32 {
    (gy as f32) - (map_height as f32) / 2.0 + 0.5
}

pub fn parse_map_json(json: &str) -> Result<ParsedMap, String> {
    let m: MapJson = serde_json::from_str(json).map_err(|e| e.to_string())?;
    for w in &m.walls {
        if w.height != 1 && w.height != 2 {
            return Err(format!("Wall height must be 1 or 2, got {}", w.height));
        }
        if w.x >= m.width || w.y >= m.height {
            return Err(format!(
                "Wall cell ({}, {}) out of bounds (width {}, height {})",
                w.x, w.y, m.width, m.height
            ));
        }
    }
    let launchers: Vec<_> = m
        .launchers
        .into_iter()
        .map(|l| {
            let len_sq = l.direction_x * l.direction_x
                + l.direction_y * l.direction_y
                + l.direction_z * l.direction_z;
            let (dx, dy, dz) = if len_sq > 0.0001 {
                let len = len_sq.sqrt();
                (
                    l.direction_x / len,
                    l.direction_y / len,
                    l.direction_z / len,
                )
            } else {
                (0.0, 1.0, 0.0)
            };
            (l.x, l.y, l.radius, dx, dy, dz, l.force)
        })
        .collect();

    Ok(ParsedMap {
        width: m.width,
        height: m.height,
        walls: m.walls,
        floor_grid: m.floor_grid,
        spawn_points: m
            .spawn_points
            .into_iter()
            .map(|s| (s.x, s.y, s.team))
            .collect(),
        flag_locations: m
            .flag_locations
            .into_iter()
            .map(|f| (f.x, f.y, f.team))
            .collect(),
        launchers,
    })
}

pub fn get_builtin_map_json(map_id: MapId) -> &'static str {
    match map_id {
        MapId::Arena => ARENA_JSON,
        MapId::Maze => MAZE_JSON,
        MapId::Warehouse => WAREHOUSE_JSON,
        MapId::Custom => ARENA_JSON, // Caller should use custom_map_json; fallback only
    }
}

const ARENA_JSON: &str = include_str!("../../game/maps/arena.json");
const MAZE_JSON: &str = include_str!("../../game/maps/maze.json");
const WAREHOUSE_JSON: &str = include_str!("../../game/maps/warehouse.json");
