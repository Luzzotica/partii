//! Parse map JSON once at lobby creation. Single source of truth for walls, spawns, flag locations.

use serde::Deserialize;

use crate::maps::MapId;

// ============================================================================
// JSON SCHEMA (matches frontend: width, height, walls grid, spawnPoints/flagLocations with x,y)
// ============================================================================

#[derive(Deserialize)]
pub struct MapJson {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub walls: Vec<WallCell>,
    /// Optional floor grid: [row][col], 1 = solid, 0 = hole. If missing, entire floor is solid.
    #[serde(rename = "floorGrid", default)]
    pub floor_grid: Option<Vec<Vec<u8>>>,
    #[serde(rename = "spawnPoints", default)]
    pub spawn_points: Vec<SpawnPointJson>,
    #[serde(rename = "flagLocations", default)]
    pub flag_locations: Vec<FlagLocationJson>,
}

#[derive(Deserialize)]
pub struct WallCell {
    pub x: u32,
    pub y: u32,
    pub height: i32, // 1 or 2
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

// ============================================================================
// PARSED MAP (in-memory, used to create geometry and fill DB tables)
// ============================================================================

pub struct ParsedMap {
    pub width: u32,
    pub height: u32,
    pub walls: Vec<WallCell>,
    /// Floor grid: [row][col], 1 = solid, 0 = hole. None = entire floor solid.
    pub floor_grid: Option<Vec<Vec<u8>>>,
    pub spawn_points: Vec<(f32, f32, Option<i32>)>, // (x, z_world, team)
    pub flag_locations: Vec<(f32, f32, i32)>,       // (x, z_world, team)
}

/// Grid cell to world position (center of cell). Babylon: X and Z are horizontal; JSON y is Z.
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
    })
}

/// Built-in map JSON (embedded). Used when no custom_map_json is provided.
pub fn get_builtin_map_json(map_id: MapId) -> &'static str {
    match map_id {
        MapId::Arena => ARENA_JSON,
        MapId::Maze => MAZE_JSON,
        MapId::Warehouse => WAREHOUSE_JSON,
    }
}

const ARENA_JSON: &str = include_str!("../../game/maps/arena.json");
const MAZE_JSON: &str = include_str!("../../game/maps/maze.json");
const WAREHOUSE_JSON: &str = include_str!("../../game/maps/warehouse.json");
