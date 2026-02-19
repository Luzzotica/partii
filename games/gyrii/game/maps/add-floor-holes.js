#!/usr/bin/env node
/**
 * One-off script: add floorGrid with holes to arena, maze, warehouse.
 * Run from game/maps: node add-floor-holes.js
 */
const fs = require("fs");
const path = require("path");

const W = 50,
  H = 50;

function fullGrid() {
  return Array(H)
    .fill(0)
    .map(() => Array(W).fill(1));
}

function punch(grid, row, col) {
  if (row >= 0 && row < H && col >= 0 && col < W) grid[row][col] = 0;
}

function punchRect(grid, r0, c0, r1, c1) {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) punch(grid, r, c);
}

// Arena: center 2x2 pit, four 2x2 pits along the sides
function arenaHoles() {
  const g = fullGrid();
  punchRect(g, 24, 24, 25, 25); // center
  punchRect(g, 5, 5, 6, 6); // NW
  punchRect(g, 5, 24, 6, 25); // N
  punchRect(g, 5, 44, 6, 45); // NE
  punchRect(g, 24, 44, 25, 45); // E
  punchRect(g, 44, 24, 45, 25); // S
  punchRect(g, 44, 5, 45, 6); // W
  punchRect(g, 24, 5, 25, 6); // W mid
  return g;
}

// Maze: small pits in corridor-like spots (avoid walls)
function mazeHoles() {
  const g = fullGrid();
  punchRect(g, 10, 10, 11, 11);
  punchRect(g, 25, 25, 26, 26);
  punchRect(g, 40, 40, 41, 41);
  punchRect(g, 15, 30, 16, 31);
  punchRect(g, 30, 15, 31, 16);
  punchRect(g, 8, 20, 9, 21);
  punchRect(g, 38, 28, 39, 29);
  return g;
}

// Warehouse: loading-dock style gaps
function warehouseHoles() {
  const g = fullGrid();
  punchRect(g, 5, 5, 6, 6);
  punchRect(g, 5, 44, 6, 45);
  punchRect(g, 44, 5, 45, 6);
  punchRect(g, 44, 44, 45, 45);
  punchRect(g, 24, 24, 26, 26); // larger center pit
  punchRect(g, 12, 30, 13, 31);
  punchRect(g, 35, 18, 36, 19);
  return g;
}

const dir = __dirname;

for (const { file, fn } of [
  { file: "arena.json", fn: arenaHoles },
  { file: "maze.json", fn: mazeHoles },
  { file: "warehouse.json", fn: warehouseHoles },
]) {
  const p = path.join(dir, file);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  data.floorGrid = fn();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  console.log("Updated", file);
}

console.log("Done.");
