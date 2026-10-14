import * as Phaser from "phaser";
import { HexGrid } from "../utils/HexGrid";
import type { HexCoord } from "../utils/HexGrid";
import {
  COLORS,
  HEX_SIZE,
  PLAYER_SPEED,
  PLAYER_ACCELERATION,
  PLAYER_DRAG,
} from "../config";
import type { HexModule, HexColor } from "../../store/gameStore";
import { useGameStore } from "../../store/gameStore";
import { Projectile, type ProjectileConfig } from "./Projectile";
import { synergyCalculator } from "../utils/SynergyCalculator";
import { SYNERGY_VALUES } from "../config/SynergyConfig";
import { audioManager } from "../audio/AudioManager";
import { isMobileDevice } from "@/lib/utils/mobile-detector";
import type { Enemy } from "./Enemy";

export class Player {
  private scene: Phaser.Scene;
  private hexGrid: HexGrid;
  private hexSprites: Map<string, Phaser.GameObjects.Graphics>;
  private container: Phaser.GameObjects.Container;
  private shipData: Map<string, HexModule>;

  // Physics body for movement
  private body: Phaser.Physics.Arcade.Body;

  // Input
  private cursors: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  // Shooting
  private mousePointer: Phaser.Input.Pointer;
  private isShooting: boolean = false;
  private shootCooldowns: Map<string, number> = new Map();
  private projectiles: Projectile[] = [];

  // Shooting constants
  private readonly BASE_FIRE_RATE = 1000; // ms between shots (1.0s as per design doc)
  private readonly PROJECTILE_SPEED = 500;
  private readonly PROJECTILE_DAMAGE = 10;
  private readonly PROJECTILE_SIZE = 4; // Doubled from 2
  private readonly PROJECTILE_LIFETIME = 2000; // ms

  // Movement synergy tracking
  private lastMoveTime: number = 0;
  private dashCooldown: number = 0;
  private lastDashDirection: { x: number; y: number } | null = null;
  private dashTimeWindow: number = 300; // ms window for double-tap

  // Mobile support
  private isMobile: boolean = false;
  private getEnemiesCallback: (() => Enemy[]) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.hexGrid = new HexGrid(HEX_SIZE);
    this.hexSprites = new Map();
    this.shipData = new Map();

    // Create container to hold all hex sprites
    this.container = scene.add.container(x, y);

    // Add physics body to container
    scene.physics.add.existing(this.container);
    this.body = this.container.body as Phaser.Physics.Arcade.Body;
    // Remove world bounds - camera will follow player instead
    this.body.setCollideWorldBounds(false);
    this.body.setDrag(PLAYER_DRAG, PLAYER_DRAG);
    this.body.setMaxVelocity(PLAYER_SPEED, PLAYER_SPEED);

    // Set up WASD controls - don't capture to allow typing in input fields
    this.cursors = {
      up: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
      down: scene.input.keyboard!.addKey(
        Phaser.Input.Keyboard.KeyCodes.S,
        false,
      ),
      left: scene.input.keyboard!.addKey(
        Phaser.Input.Keyboard.KeyCodes.A,
        false,
      ),
      right: scene.input.keyboard!.addKey(
        Phaser.Input.Keyboard.KeyCodes.D,
        false,
      ),
    };

    // Set up mouse input
    this.mousePointer = scene.input.activePointer;

    // Shooting is always active (no click needed)
    this.isShooting = true;

    // Check if mobile
    this.isMobile = isMobileDevice();
  }

  /**
   * Set callback to get enemies list (called from MainScene)
   */
  setEnemiesCallback(callback: () => Enemy[]): void {
    this.getEnemiesCallback = callback;
  }

  /**
   * Find the closest enemy to the player
   */
  private findClosestEnemy(): { x: number; y: number } | null {
    if (!this.getEnemiesCallback) return null;

    const enemies = this.getEnemiesCallback();
    if (enemies.length === 0) return null;

    const playerPos = this.getPosition();
    let closestEnemy: Enemy | null = null;
    let closestDistance = Infinity;

    for (const enemy of enemies) {
      if (!enemy.active) continue;

      const dx = enemy.x - playerPos.x;
      const dy = enemy.y - playerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestEnemy = enemy;
      }
    }

    if (closestEnemy) {
      return { x: closestEnemy.x, y: closestEnemy.y };
    }

    return null;
  }

  /**
   * Initialize the ship from game store data
   */
  initFromStore(shipData: Record<string, HexModule>): void {
    // Clear existing sprites
    this.hexSprites.forEach((sprite) => sprite.destroy());
    this.hexSprites.clear();
    this.shipData.clear();

    // Create sprites for each hex
    Object.entries(shipData).forEach(([key, hex]) => {
      this.shipData.set(key, hex);
      this.createHexSprite(key, hex);
    });

    this.updateBodySize();
  }

  /**
   * Add a single hex to the ship
   */
  addHex(key: string, hex: HexModule): void {
    this.shipData.set(key, hex);
    this.createHexSprite(key, hex);
    this.updateBodySize();
  }

  /**
   * Create a hexagon sprite at the given axial coordinate
   */
  private createHexSprite(key: string, hex: HexModule): void {
    const coord = HexGrid.fromKey(key);
    const pixel = this.hexGrid.axialToPixel(coord);

    const graphics = this.scene.add.graphics();
    this.drawHexagon(graphics, hex.color, hex.type === "CORE");
    graphics.setPosition(pixel.x, pixel.y);

    this.container.add(graphics);
    this.hexSprites.set(key, graphics);
  }

  /**
   * Draw a hexagon shape
   */
  private drawHexagon(
    graphics: Phaser.GameObjects.Graphics,
    color: HexColor,
    isCore: boolean = false,
  ): void {
    const colorValue = COLORS[color];
    const size = HEX_SIZE - 2; // Slight gap between hexes

    // Draw fill
    graphics.fillStyle(colorValue, 0.8);
    graphics.beginPath();

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2; // Start from top
      const x = size * Math.cos(angle);
      const y = size * Math.sin(angle);

      if (i === 0) {
        graphics.moveTo(x, y);
      } else {
        graphics.lineTo(x, y);
      }
    }

    graphics.closePath();
    graphics.fillPath();

    // Draw outline
    graphics.lineStyle(2, 0xffffff, 0.5);
    graphics.beginPath();

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const x = size * Math.cos(angle);
      const y = size * Math.sin(angle);

      if (i === 0) {
        graphics.moveTo(x, y);
      } else {
        graphics.lineTo(x, y);
      }
    }

    graphics.closePath();
    graphics.strokePath();

    // Draw core indicator (eye/cockpit)
    if (isCore) {
      graphics.fillStyle(0xffffff, 0.9);
      graphics.fillCircle(0, 0, size * 0.3);
      graphics.fillStyle(0x000000, 1);
      graphics.fillCircle(0, 0, size * 0.15);
    }
  }

  /**
   * Update physics body size based on ship size
   */
  private updateBodySize(): void {
    // Calculate bounding radius
    let maxDist = HEX_SIZE;

    this.shipData.forEach((_, key) => {
      const coord = HexGrid.fromKey(key);
      const pixel = this.hexGrid.axialToPixel(coord);
      const dist = Math.sqrt(pixel.x ** 2 + pixel.y ** 2) + HEX_SIZE;
      maxDist = Math.max(maxDist, dist);
    });

    // Set circular body
    this.body.setCircle(maxDist);
    this.body.setOffset(-maxDist, -maxDist);
  }

  /**
   * Stop all player movement (freeze in place)
   */
  stopMovement(): void {
    this.body.setVelocity(0, 0);
    this.body.setAcceleration(0, 0);
  }

  /**
   * Calculate movement speed multiplier from YELLOW synergies
   */
  private calculateMovementSpeedMultiplier(): number {
    const shipDataRecord: Record<string, HexModule> = {};
    this.shipData.forEach((value, key) => {
      shipDataRecord[key] = value;
    });

    const stats = synergyCalculator.calculate(shipDataRecord);
    return stats.moveSpeedMultiplier;
  }

  /**
   * Check for dash (YELLOW + YELLOW - double tap)
   */
  private checkDash(delta: number): { dashX: number; dashY: number } | null {
    const shipDataRecord: Record<string, HexModule> = {};
    this.shipData.forEach((value, key) => {
      shipDataRecord[key] = value;
    });

    const stats = synergyCalculator.calculate(shipDataRecord);

    if (!stats.hasDash) {
      this.dashCooldown = 0;
      this.lastDashDirection = null;
      return null;
    }

    // Update dash cooldown
    this.dashCooldown += delta;
    if (this.dashCooldown > this.dashTimeWindow * 2) {
      this.lastDashDirection = null;
    }

    // Check for double tap
    let currentDir: { x: number; y: number } | null = null;
    if (this.cursors.left.isDown) currentDir = { x: -1, y: 0 };
    else if (this.cursors.right.isDown) currentDir = { x: 1, y: 0 };
    else if (this.cursors.up.isDown) currentDir = { x: 0, y: -1 };
    else if (this.cursors.down.isDown) currentDir = { x: 0, y: 1 };

    if (currentDir) {
      if (
        this.lastDashDirection &&
        this.lastDashDirection.x === currentDir.x &&
        this.lastDashDirection.y === currentDir.y &&
        this.dashCooldown < this.dashTimeWindow * 2 &&
        this.dashCooldown > this.dashTimeWindow
      ) {
        // Double tap detected - dash!
        this.dashCooldown = 0;
        this.lastDashDirection = null;
        const dashForce = SYNERGY_VALUES.TURBO.dashForce;
        return {
          dashX: currentDir.x * dashForce,
          dashY: currentDir.y * dashForce,
        };
      } else {
        this.lastDashDirection = currentDir;
        this.dashCooldown = 0;
      }
    }

    return null;
  }

  /**
   * Check if an input element is currently focused
   */
  private isInputFocused(): boolean {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    const tagName = activeElement.tagName.toLowerCase();
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      activeElement.getAttribute("contenteditable") === "true"
    );
  }

  /**
   * Update player each frame
   */
  update(time: number, delta: number): void {
    // Check if user is typing in an input field - skip game input processing
    const isTyping = this.isInputFocused();

    // Calculate movement speed multiplier
    const speedMultiplier = this.calculateMovementSpeedMultiplier();
    const currentMaxSpeed = PLAYER_SPEED * speedMultiplier;
    this.body.setMaxVelocity(currentMaxSpeed, currentMaxSpeed);

    // Handle movement (joystick on mobile, WASD on desktop)
    let accelX = 0;
    let accelY = 0;

    // Skip input processing if user is typing in an input field
    if (!isTyping) {
      if (this.isMobile) {
        // Use joystick input from gameStore
        const joystickInput = useGameStore.getState().joystickInput;
        if (joystickInput) {
          accelX = joystickInput.x;
          accelY = joystickInput.y;
        }
      } else {
        // Use WASD controls
        if (this.cursors.left.isDown) {
          accelX = -1;
        } else if (this.cursors.right.isDown) {
          accelX = 1;
        }

        if (this.cursors.up.isDown) {
          accelY = -1;
        } else if (this.cursors.down.isDown) {
          accelY = 1;
        }

        // Check for dash (YELLOW + YELLOW) - only on desktop
        const dash = this.checkDash(delta);
        if (dash) {
          this.body.setVelocity(
            this.body.velocity.x + dash.dashX,
            this.body.velocity.y + dash.dashY,
          );
        }
      }
    }

    // Normalize diagonal movement so it's not faster
    if (accelX !== 0 || accelY !== 0) {
      const magnitude = Math.sqrt(accelX * accelX + accelY * accelY);
      accelX = (accelX / magnitude) * PLAYER_ACCELERATION;
      accelY = (accelY / magnitude) * PLAYER_ACCELERATION;
    }

    this.body.setAcceleration(accelX, accelY);

    // Shoot towards mouse (desktop) or closest enemy (mobile)
    this.updateShooting(time, delta);

    // Update cooldowns
    this.shootCooldowns.forEach((cooldown, key) => {
      if (cooldown > 0) {
        this.shootCooldowns.set(key, cooldown - delta);
      }
    });

    // Clean up destroyed projectiles
    this.projectiles = this.projectiles.filter((p) => p.active);
  }

  /**
   * Update shooting logic
   */
  private updateShooting(_time: number, _delta: number): void {
    // On mobile, target closest enemy; on desktop, use mouse
    let targetX: number;
    let targetY: number;

    if (this.isMobile) {
      const closestEnemy = this.findClosestEnemy();
      if (closestEnemy) {
        targetX = closestEnemy.x;
        targetY = closestEnemy.y;
      } else {
        // No enemies, don't shoot
        return;
      }
    } else {
      targetX = this.mousePointer.worldX;
      targetY = this.mousePointer.worldY;
    }

    // Find all Red hexes and Core (Core always shoots)
    const shootingHexes: Array<{
      key: string;
      hex: HexModule;
      coord: HexCoord;
    }> = [];

    this.shipData.forEach((hex, key) => {
      if (hex.color === "RED" || hex.type === "CORE") {
        const coord = HexGrid.fromKey(key);
        shootingHexes.push({ key, hex, coord });
      }
    });

    // Fire from each shooting hex
    shootingHexes.forEach(({ key, hex, coord }) => {
      const cooldown = this.shootCooldowns.get(key) || 0;

      if (cooldown <= 0) {
        // Calculate adjacency bonuses
        const bonuses = this.calculateShootingBonuses(coord, hex);

        // Fire projectiles (multiple if Red+Red adjacency)
        const projectileCount = bonuses.projectileCount;

        for (let i = 0; i < projectileCount; i++) {
          const angleOffset =
            projectileCount > 1
              ? (i - (projectileCount - 1) / 2) * 0.1 // Spread for multiple projectiles
              : 0;

          this.fireProjectile(coord, targetX, targetY, bonuses, angleOffset);
        }

        // Set cooldown (reduced if Yellow adjacency)
        const fireRate = this.BASE_FIRE_RATE * bonuses.fireRateMultiplier;
        this.shootCooldowns.set(key, fireRate);

        // Visual feedback - slight recoil
        const sprite = this.hexSprites.get(key);
        if (sprite) {
          const pixel = this.hexGrid.axialToPixel(coord);
          const originalX = pixel.x;
          const originalY = pixel.y;

          this.scene.tweens.add({
            targets: sprite,
            x:
              originalX -
              Math.cos(
                Math.atan2(
                  targetY - (this.container.y + originalY),
                  targetX - (this.container.x + originalX),
                ),
              ) *
                3,
            y:
              originalY -
              Math.sin(
                Math.atan2(
                  targetY - (this.container.y + originalY),
                  targetX - (this.container.x + originalX),
                ),
              ) *
                3,
            duration: 50,
            yoyo: true,
            ease: "Power2",
          });
        }
      }
    });
  }

  /**
   * Calculate shooting bonuses based on synergies
   */
  private calculateShootingBonuses(
    coord: HexCoord,
    _hex: HexModule,
  ): {
    projectileCount: number;
    damageMultiplier: number;
    sizeMultiplier: number;
    fireRateMultiplier: number;
    piercing: boolean;
    homing: boolean;
    heavyImpact: boolean;
    bioOrdnance: boolean;
    bioOrdnanceCount: number;
    speedMultiplier: number;
  } {
    const shipDataRecord: Record<string, HexModule> = {};
    this.shipData.forEach((value, key) => {
      shipDataRecord[key] = value;
    });

    return synergyCalculator.getShootingBonuses(coord, shipDataRecord);
  }

  /**
   * Fire a projectile from a hex position
   */
  private fireProjectile(
    hexCoord: HexCoord,
    targetX: number,
    targetY: number,
    bonuses: {
      projectileCount: number;
      damageMultiplier: number;
      sizeMultiplier: number;
      fireRateMultiplier: number;
      piercing: boolean;
      homing: boolean;
      heavyImpact: boolean;
      bioOrdnance: boolean;
      bioOrdnanceCount: number;
      speedMultiplier: number;
    },
    angleOffset: number = 0,
  ): void {
    // Play turret fire SFX (throttled and pitch-modulated for variety)
    audioManager.playSFX("turret-fire");

    const pixel = this.hexGrid.axialToPixel(hexCoord);
    const startX = this.container.x + pixel.x;
    const startY = this.container.y + pixel.y;

    // Calculate angle to target
    const dx = targetX - startX;
    const dy = targetY - startY;
    const angle = Math.atan2(dy, dx) + angleOffset;

    // Create projectile config
    const baseDamage = this.PROJECTILE_DAMAGE * bonuses.damageMultiplier;
    const baseSize = this.PROJECTILE_SIZE * bonuses.sizeMultiplier;

    const config: ProjectileConfig = {
      damage: baseDamage,
      speed: this.PROJECTILE_SPEED * bonuses.speedMultiplier,
      size: baseSize,
      color: COLORS.RED,
      piercing: bonuses.piercing,
      lifetime: this.PROJECTILE_LIFETIME,
      homing: bonuses.homing,
      bioOrdnance: bonuses.bioOrdnance,
      heavyImpact: bonuses.heavyImpact,
      baseDamage: bonuses.bioOrdnance ? baseDamage : undefined,
      baseSize: bonuses.bioOrdnance ? baseSize : undefined,
      bioOrdnanceCount: bonuses.bioOrdnance
        ? bonuses.bioOrdnanceCount
        : undefined,
    };

    const projectile = new Projectile(
      this.scene,
      startX,
      startY,
      angle,
      config,
    );
    this.projectiles.push(projectile);
  }

  /**
   * Get all active projectiles
   */
  getProjectiles(): Projectile[] {
    return this.projectiles.filter((p) => p.active);
  }

  /**
   * Get the player's current position
   */
  getPosition(): { x: number; y: number } {
    return {
      x: this.container.x,
      y: this.container.y,
    };
  }

  /**
   * Get the container for collision detection
   */
  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /**
   * Get the physics body
   */
  getBody(): Phaser.Physics.Arcade.Body {
    return this.body;
  }

  /**
   * Get ship data
   */
  getShipData(): Map<string, HexModule> {
    return this.shipData;
  }

  /**
   * Get valid attachment points (empty neighbors of existing hexes)
   */
  getValidAttachmentPoints(): HexCoord[] {
    const occupied = new Set(this.shipData.keys());
    const validPoints: HexCoord[] = [];
    const checked = new Set<string>();

    this.shipData.forEach((_, key) => {
      const coord = HexGrid.fromKey(key);
      const neighbors = this.hexGrid.getNeighbors(coord);

      neighbors.forEach((neighbor) => {
        const neighborKey = HexGrid.toKey(neighbor);
        if (!occupied.has(neighborKey) && !checked.has(neighborKey)) {
          checked.add(neighborKey);
          validPoints.push(neighbor);
        }
      });
    });

    return validPoints;
  }

  /**
   * Get pixel position for a hex coordinate
   */
  getPixelForHex(hex: HexCoord): { x: number; y: number } {
    const pixel = this.hexGrid.axialToPixel(hex);
    return {
      x: this.container.x + pixel.x,
      y: this.container.y + pixel.y,
    };
  }

  /**
   * Visual feedback when taking damage
   */
  flashDamage(): void {
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0.3,
      duration: 50,
      yoyo: true,
      repeat: 2,
    });

    // Screen shake
    this.scene.cameras.main.shake(100, 0.01);
  }

  /**
   * Get all hex world positions for per-hexagon collision detection
   */
  getHexWorldPositions(): Array<{ x: number; y: number; size: number }> {
    const positions: Array<{ x: number; y: number; size: number }> = [];

    this.shipData.forEach((_, key) => {
      const coord = HexGrid.fromKey(key);
      const pixel = this.hexGrid.axialToPixel(coord);
      positions.push({
        x: this.container.x + pixel.x,
        y: this.container.y + pixel.y,
        size: HEX_SIZE,
      });
    });

    return positions;
  }
}
