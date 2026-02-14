import * as Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";

// Fixed game width for consistency across screens
export const GAME_WIDTH = 1000;

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: typeof window !== "undefined" ? window.innerWidth : 1000,
  height: typeof window !== "undefined" ? window.innerHeight : 600,
  backgroundColor: "#1a1020", // Dark purple/black starting color
  parent: "game-container",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 800 }, // Strong downward gravity
      debug: false,
    },
  },
  scene: [MainScene],
  pixelArt: false,
  antialias: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

// Heavenly color palette
export const COLORS = {
  // Backgrounds (gradient from despair to heaven)
  ABYSS: 0x1a0a0a, // Deep red-black
  DESPAIR: 0x1a1020, // Dark purple
  PURGATORY: 0x2a2040, // Muted purple
  HOPE: 0x4a5080, // Blue-gray
  LIGHT: 0x8090c0, // Light blue
  HEAVEN: 0xff8c42, // Coral orange (less bright, more orange than yellow)

  // Game elements
  PLAYER: 0xffffff, // Legacy / fallback
  ROCKET_FLAME: 0xffa500, // Orange flame

  // Player character (wheelchair + person)
  WHEELCHAIR_FRAME: 0x1a1a1a, // Black wheelchair & backrest
  WHEELCHAIR_WHEEL: 0x444444, // Dark grey wheel rims
  PLAYER_SKIN: 0xe8c4a0, // Peachy-beige skin
  PLAYER_HAIR: 0x8b7355, // Light brown hair
  PLAYER_CLOTHING: 0x2c5282, // Dark blue vest/shirt
  PLAYER_FACE: 0x333333, // Eyes, brows, mouth outline
  PLAYER_BEARD: 0x7a6348, // Slightly darker brown beard
  LAVA: 0xff3300, // Red-orange lava
  LAVA_GLOW: 0xff6600,

  // Blocks (metaphorical weights)
  BLOCK_DEBT: 0x8b0000, // Dark red
  BLOCK_GRIEF: 0x2f2f4f, // Dark slate
  BLOCK_STRESS: 0x4a0080, // Purple
  BLOCK_FEAR: 0x1a1a1a, // Near black
  BLOCK_LOSS: 0x003366, // Dark blue

  // Positive elements
  GRACE_ORB: 0xffd700, // Gold
  GRACE_GLOW: 0xfffacd, // Light gold
  ANGEL: 0xffffff,

  // UI
  TEXT_LIGHT: 0xffffff,
  TEXT_GOLD: 0xffd700,
};

// Game constants
export const GAME_CONSTANTS = {
  // Goal
  HEAVEN_HEIGHT: 10000, // 10,000 pixels up to win

  // Player physics
  PLAYER_WIDTH: 40,
  PLAYER_HEIGHT: 50,
  JUMP_VELOCITY: -450, // Rocket hop impulse
  BOOST_MULTIPLIER: 1.2, // 20% boost from near miss
  MOVE_SPEED: 200,
  AIR_CONTROL: 0.8, // Reduced control in air
  WALL_SLIDE_SPEED: 100, // Max fall speed when sliding
  WALL_JUMP_X: 300, // Horizontal impulse from wall jump
  WALL_JUMP_Y: -400, // Vertical impulse from wall jump

  // Abyss/Lava
  ABYSS_START_DELAY: 5000, // ms before lava starts rising
  ABYSS_START_Y: 400, // Initial abyss position (well below screen)
  ABYSS_RISE_SPEED: 20, // Pixels per second the lava rises
  ABYSS_RISE_ACCELERATION: 0.05, // Speed increase per second

  // Starting platform
  PLATFORM_WIDTH: 300,
  PLATFORM_HEIGHT: 30,

  // Blocks - base sizes (will be varied)
  BLOCK_MIN_WIDTH: 60,
  BLOCK_MAX_WIDTH: 240,
  BLOCK_MIN_HEIGHT: 60,
  BLOCK_MAX_HEIGHT: 240,
  BLOCK_FALL_SPEED: 60, // All blocks fall at same speed (20% faster)
  BLOCK_SPAWN_RATE: 2500, // ms between block spawns (less frequent)
  BLOCK_SPAWN_VARIANCE: 500, // Random variance in spawn timing

  // Grace orbs
  GRACE_SPAWN_CHANCE: 0.35, // 35% chance per block spawn
  GRACE_ORB_SIZE: 30,

  // Near miss
  NEAR_MISS_DISTANCE: 15, // Pixels within which triggers near miss
  NEAR_MISS_BOOST_DURATION: 1500, // ms

  // Camera
  CAMERA_DEAD_ZONE_Y: 200, // Player can move this far before camera follows
};

// Block types with labels and colors - before heaven
export const BLOCK_TYPES = [
  { label: "DEBT", color: 0x8b0000 }, // Dark red
  { label: "GRIEF", color: 0x2f2f4f }, // Dark slate blue
  { label: "STRESS", color: 0x6b238e }, // Purple
  { label: "FEAR", color: 0x1c1c1c }, // Near black
  { label: "LOSS", color: 0x003366 }, // Dark blue
  { label: "ANXIETY", color: 0x4a235a }, // Dark purple
  { label: "REGRET", color: 0x3d3d3d }, // Dark gray
  { label: "DOUBT", color: 0x2c3e50 }, // Midnight blue
  { label: "SHAME", color: 0x641e16 }, // Dark maroon
  { label: "ANGER", color: 0xb22222 }, // Firebrick red
  { label: "ENVY", color: 0x1e3d1e }, // Dark green
  { label: "GUILT", color: 0x4a4a2f }, // Dark olive
];

// Heavenly block types - after reaching heaven
export const HEAVENLY_BLOCK_TYPES = [
  { label: "JOY", color: 0xffeb3b }, // Bright yellow
  { label: "ABUNDANCE", color: 0x4caf50 }, // Green
  { label: "BEAUTY", color: 0xe91e63 }, // Pink
  { label: "HAPPINESS", color: 0xff9800 }, // Orange
  { label: "GRATITUDE", color: 0x9c27b0 }, // Purple
  { label: "PEACE", color: 0x03a9f4 }, // Blue
  { label: "LOVE", color: 0xf44336 }, // Red
  { label: "HOPE", color: 0x00bcd4 }, // Cyan
  { label: "FAITH", color: 0xcddc39 }, // Lime
  { label: "GRACE", color: 0xffc107 }, // Amber
  { label: "BLESSING", color: 0x8bc34a }, // Light green
  { label: "WONDER", color: 0x673ab7 }, // Deep purple
];
