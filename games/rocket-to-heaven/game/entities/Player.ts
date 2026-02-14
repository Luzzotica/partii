import * as Phaser from "phaser";
import { COLORS, GAME_CONSTANTS } from "../config";
import { useGameStore } from "../../store/gameStore";
import { audioManager } from "../audio/AudioManager";

type PlayerState = "idle" | "jumping" | "falling" | "wall_slide" | "dead";

export class Player extends Phaser.GameObjects.Container {
  public body!: Phaser.Physics.Arcade.Body;
  private wheelchair: Phaser.GameObjects.Graphics;
  private rocketFlame: Phaser.GameObjects.Graphics;
  private playerState: PlayerState = "idle";
  private facingRight: boolean = true;
  private isOnGround: boolean = false;
  private isTouchingWall: boolean = false;
  private wallDirection: number = 0; // -1 left, 1 right
  private hasAirJumped: boolean = false; // Track if already used air jump
  private jumpCooldown: number = 0;
  private lastJumpPressed: boolean = false;
  private flameParticles: Phaser.GameObjects.Particles.ParticleEmitter | null =
    null;
  private victoryTriggered: boolean = false; // Track if victory was already triggered
  // Input - don't capture to allow typing in input fields
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: {
    a: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    // Create wheelchair graphic
    this.wheelchair = scene.add.graphics();
    this.drawWheelchair();
    this.add(this.wheelchair);

    // Create rocket flame graphic (hidden initially)
    this.rocketFlame = scene.add.graphics();
    this.drawRocketFlame();
    this.rocketFlame.setVisible(false);
    this.add(this.rocketFlame);

    // Add to scene and enable physics
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Configure physics body
    this.body.setSize(
      GAME_CONSTANTS.PLAYER_WIDTH,
      GAME_CONSTANTS.PLAYER_HEIGHT,
    );
    this.body.setOffset(
      -GAME_CONSTANTS.PLAYER_WIDTH / 2,
      -GAME_CONSTANTS.PLAYER_HEIGHT / 2,
    );
    this.body.setCollideWorldBounds(false);
    this.body.setMaxVelocity(400, 600);

    // Set up keyboard controls - don't capture to allow typing in input fields
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.keys = {
      a: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
      d: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
      w: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
      space: scene.input.keyboard!.addKey(
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        false,
      ),
    };

    // Create flame particle emitter
    this.createFlameParticles();
  }

  private drawWheelchair(): void {
    const g = this.wheelchair;
    g.clear();

    const rocketX = -20;
    const rocketY = -30;

    // —— Wheelchair (black) ——
    g.fillStyle(COLORS.WHEELCHAIR_FRAME, 1);
    g.fillRoundedRect(-15, -20, 30, 25, 4); // Seat
    g.fillRoundedRect(-15, -35, 8, 20, 2); // Backrest (black)

    // Wheels (dark grey rims)
    g.lineStyle(3, COLORS.WHEELCHAIR_WHEEL, 1);
    g.strokeCircle(-12, 10, 12);
    g.strokeCircle(12, 10, 8);
    g.lineStyle(1, COLORS.WHEELCHAIR_WHEEL, 0.6);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      g.lineBetween(
        -12,
        10,
        -12 + Math.cos(angle) * 10,
        10 + Math.sin(angle) * 10,
      );
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      g.lineBetween(12, 10, 12 + Math.cos(angle) * 6, 10 + Math.sin(angle) * 6);
    }

    // Rocket attachment (on the back)
    g.fillStyle(0x555555, 1);
    g.fillRect(rocketX, rocketY, 8, 20);
    g.fillStyle(0xff4444, 1);
    g.fillTriangle(
      rocketX,
      rocketY + 20,
      rocketX + 4,
      rocketY + 30,
      rocketX + 8,
      rocketY + 20,
    );

    // —— Person (order: hair behind, then torso, then head, then face/beard) ——
    const headX = -5;
    const headY = -38;
    const headR = 7;

    // Hair — drawn first so it sits behind everything
    g.fillStyle(COLORS.PLAYER_HAIR, 1);
    g.fillCircle(headX, headY - 2, headR + 1.5);

    // Torso (blue) — below the head so head sits above the blue square
    g.fillStyle(COLORS.PLAYER_CLOTHING, 1);
    g.fillRoundedRect(-11, -28, 14, 14, 2);

    // Head (skin) — circular, clearly above the blue
    g.fillStyle(COLORS.PLAYER_SKIN, 1);
    g.fillCircle(headX, headY, headR);

    // Beard (stays on head, above neck)
    g.fillStyle(COLORS.PLAYER_BEARD, 0.75);
    g.fillEllipse(headX, headY + 4, 10, 5);

    // Face
    g.fillStyle(COLORS.PLAYER_FACE, 1);
    g.fillCircle(headX - 2.5, headY - 2, 1.2);
    g.fillCircle(headX + 2.5, headY - 2, 1.2);
    g.fillCircle(headX, headY + 0.5, 0.7);
    g.lineStyle(1.3, 0xffffff, 1);
    g.beginPath();
    g.arc(headX, headY + 1.5, 2.5, 0.2 * Math.PI, 0.8 * Math.PI);
    g.strokePath();
  }

  private drawRocketFlame(): void {
    const g = this.rocketFlame;
    g.clear();

    // Draw flame (pointing down from rocket), based on rocketX = -20, rocketY = -30
    const rocketX = -20;
    const rocketY = -40;
    g.fillStyle(COLORS.ROCKET_FLAME, 0.9);
    g.fillTriangle(
      rocketX - 2,
      rocketY + 35, // left base
      rocketX + 4,
      rocketY + 55, // tip (bottom)
      rocketX + 8,
      rocketY + 35, // right base
    );

    // Inner flame
    g.fillStyle(0xffff00, 0.8);
    g.fillTriangle(
      rocketX - 1,
      rocketY + 38, // left base (inner)
      rocketX + 4,
      rocketY + 48, // tip (inner)
      rocketX + 7,
      rocketY + 38, // right base (inner)
    );
  }

  private createFlameParticles(): void {
    // Create a simple particle texture
    const particleGraphics = this.scene.add.graphics();
    particleGraphics.fillStyle(0xffffff, 1);
    particleGraphics.fillCircle(4, 4, 4);
    particleGraphics.generateTexture("flame_particle", 8, 8);
    particleGraphics.destroy();

    // Create particle emitter
    this.flameParticles = this.scene.add.particles(0, 0, "flame_particle", {
      speed: { min: 50, max: 150 },
      angle: { min: 80, max: 100 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 300,
      tint: [COLORS.ROCKET_FLAME, 0xffff00, 0xff4400],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 30,
      emitting: false,
    });
    this.flameParticles.setDepth(this.depth - 1);
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

  public update(delta: number): void {
    if (this.playerState === "dead") return;

    const store = useGameStore.getState();

    // Check for near miss boost expiry
    if (store.hasNearMissBoost && Date.now() > store.nearMissBoostEndTime) {
      store.setNearMissBoost(false);
    }

    // Check if user is typing in an input field - skip game input processing
    const isTyping = this.isInputFocused();

    // Movement input (keyboard or joystick)
    let moveX = 0;

    // Skip keyboard input processing if user is typing in an input field
    if (!isTyping) {
      if (this.cursors.left.isDown || this.keys.a.isDown) moveX -= 1;
      if (this.cursors.right.isDown || this.keys.d.isDown) moveX += 1;
    }

    // Joystick input (mobile) - always allow joystick input
    if (store.joystickInput) {
      moveX = store.joystickInput.x;
    }

    // Jump input - skip keyboard input if typing
    const jumpPressed =
      (!isTyping &&
        (this.cursors.up.isDown ||
          this.keys.space.isDown ||
          this.keys.w.isDown)) ||
      store.jumpPressed;

    // Update jump cooldown
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= delta;
    }

    // Check ground/wall state
    this.isOnGround = this.body.blocked.down || this.body.touching.down;
    this.isTouchingWall =
      this.body.blocked.left ||
      this.body.blocked.right ||
      this.body.touching.left ||
      this.body.touching.right;

    if (this.body.blocked.left || this.body.touching.left) {
      this.wallDirection = -1;
    } else if (this.body.blocked.right || this.body.touching.right) {
      this.wallDirection = 1;
    } else {
      this.wallDirection = 0;
    }

    // Update state based on physics
    this.updateState();

    // Apply movement
    const isInAir = !this.isOnGround;
    const controlMultiplier = isInAir ? GAME_CONSTANTS.AIR_CONTROL : 1;
    const targetVelX = moveX * GAME_CONSTANTS.MOVE_SPEED * controlMultiplier;

    // Lerp toward target velocity for smoother control
    const currentVelX = this.body.velocity.x;
    const newVelX = Phaser.Math.Linear(currentVelX, targetVelX, 0.15);
    this.body.setVelocityX(newVelX);

    // Update facing direction
    if (moveX > 0.1) this.facingRight = true;
    else if (moveX < -0.1) this.facingRight = false;

    // Wall slide - slow down fall when touching wall and falling
    if (this.playerState === "wall_slide") {
      const currentVelY = this.body.velocity.y;
      if (currentVelY > GAME_CONSTANTS.WALL_SLIDE_SPEED) {
        this.body.setVelocityY(GAME_CONSTANTS.WALL_SLIDE_SPEED);
      }
    }

    // Jump handling
    if (jumpPressed && !this.lastJumpPressed && this.jumpCooldown <= 0) {
      this.tryJump();
    }
    this.lastJumpPressed = !!jumpPressed;

    // Update visuals
    this.updateVisuals();

    // Update particle position
    if (this.flameParticles) {
      this.flameParticles.setPosition(this.x - 14, this.y + 15);
    }

    // Update height in store (convert to positive altitude)
    const height = Math.max(0, Math.floor(-this.y));
    store.setHeight(height);
    store.updateMaxHeight(height);

    // Check for victory (only trigger once)
    // After victory, player can continue climbing infinitely
    if (
      height >= GAME_CONSTANTS.HEAVEN_HEIGHT &&
      !store.hasWon &&
      !this.victoryTriggered
    ) {
      this.victoryTriggered = true;
      store.setReachedHeaven(true); // Mark that player reached heaven (for block transformation)
      this.triggerVictory();
    }

    // If player continues after victory, re-enable gravity if it was disabled
    if (!store.hasWon && !this.body.allowGravity) {
      this.body.setAllowGravity(true);
    }
  }

  private updateState(): void {
    if (this.playerState === "dead") return;

    if (this.isOnGround) {
      this.playerState = "idle";
      this.hasAirJumped = false; // Reset air jump when on ground
    } else if (this.isTouchingWall && this.body.velocity.y > 0) {
      this.playerState = "wall_slide";
      this.hasAirJumped = false; // Reset air jump when wall sliding
    } else if (this.body.velocity.y < 0) {
      this.playerState = "jumping";
    } else {
      this.playerState = "falling";
    }
  }

  private tryJump(): void {
    const store = useGameStore.getState();
    let jumped = false;

    // Calculate jump velocity with potential boost
    let jumpVel = GAME_CONSTANTS.JUMP_VELOCITY;
    if (store.hasNearMissBoost) {
      jumpVel *= GAME_CONSTANTS.BOOST_MULTIPLIER;
    }

    // Ground jump
    if (this.isOnGround) {
      this.body.setVelocityY(jumpVel);
      jumped = true;
    }
    // Wall jump
    else if (this.isTouchingWall && this.wallDirection !== 0) {
      this.body.setVelocityY(GAME_CONSTANTS.WALL_JUMP_Y);
      this.body.setVelocityX(-this.wallDirection * GAME_CONSTANTS.WALL_JUMP_X);
      this.facingRight = this.wallDirection < 0;
      jumped = true;
    }
    // Double jump (grace orb) - only if haven't already air jumped
    else if (!this.hasAirJumped && store.useGraceOrb()) {
      this.body.setVelocityY(jumpVel);
      jumped = true;
      this.hasAirJumped = true;
      this.createGraceJumpEffect();
    }
    // No grace orbs - powerful sideways dash with slight upward push (air dodge/hover)
    else if (!this.isOnGround && !this.isTouchingWall && !this.hasAirJumped) {
      const pushDirection = this.facingRight ? 1 : -1;
      this.body.setVelocityX(pushDirection * GAME_CONSTANTS.WALL_JUMP_X * 1.8);
      // Slight upward push to allow "hovering" for a moment
      this.body.setVelocityY(Math.min(this.body.velocity.y, -80));
      this.hasAirJumped = true; // Only one air dodge per jump
      this.createAirDodgeEffect();
      audioManager.playSFX("dash");
      this.jumpCooldown = 150;
      return; // Don't trigger normal jump effects
    }

    if (jumped) {
      this.jumpCooldown = 150; // 150ms cooldown
      this.playerState = "jumping";
      this.createJumpEffect();
    }
  }

  private createAirDodgeEffect(): void {
    // Quick horizontal burst effect
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y);
    g.fillStyle(0xaaaaaa, 0.6);

    const dir = this.facingRight ? -1 : 1;
    g.fillEllipse(dir * 20, 0, 30, 15);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.5,
      duration: 200,
      onComplete: () => g.destroy(),
    });
  }

  private createJumpEffect(): void {
    // Play jump sound with pitch variation
    audioManager.playSFX("jump");

    // Show flame
    this.rocketFlame.setVisible(true);
    if (this.flameParticles) {
      this.flameParticles.start();
    }

    // Hide after delay
    this.scene.time.delayedCall(200, () => {
      this.rocketFlame.setVisible(false);
      if (this.flameParticles) {
        this.flameParticles.stop();
      }
    });
  }

  private createGraceJumpEffect(): void {
    // Play ethereal double-jump sound with pitch variation
    audioManager.playSFX("double-jump");

    // Golden particle burst for grace jump
    const particles = this.scene.add.particles(
      this.x,
      this.y,
      "flame_particle",
      {
        speed: { min: 100, max: 200 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.8, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: 500,
        tint: [COLORS.GRACE_ORB, COLORS.GRACE_GLOW, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        quantity: 20,
      },
    );

    this.scene.time.delayedCall(500, () => {
      particles.destroy();
    });
  }

  private updateVisuals(): void {
    // Flip wheelchair based on facing direction
    this.wheelchair.setScale(this.facingRight ? 1 : -1, 1);
    this.rocketFlame.setScale(this.facingRight ? 1 : -1, 1);

    // Add tilt based on velocity
    const tilt = Phaser.Math.Clamp(this.body.velocity.x / 500, -0.2, 0.2);
    this.setRotation(tilt);
  }

  public triggerDeath(
    cause: "lava" | "block" = "lava",
    blockLabel?: string,
  ): void {
    if (this.playerState === "dead") return;

    this.playerState = "dead";
    const store = useGameStore.getState();

    // Play death sound
    audioManager.playSFX("death");

    // Disable input
    this.body.setVelocity(0, GAME_CONSTANTS.JUMP_VELOCITY * 0.8); // Death hop

    // Flash red and fade
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 1000,
      ease: "Power2",
      onComplete: () => {
        store.setDead(true, cause, blockLabel);
      },
    });

    // Create death particles
    const particles = this.scene.add.particles(
      this.x,
      this.y,
      "flame_particle",
      {
        speed: { min: 50, max: 150 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: 1000,
        tint: [COLORS.LAVA, COLORS.LAVA_GLOW, 0xff0000],
        blendMode: Phaser.BlendModes.ADD,
        quantity: 30,
      },
    );

    this.scene.time.delayedCall(1000, () => {
      particles.destroy();
    });
  }

  private triggerVictory(): void {
    const store = useGameStore.getState();
    store.setWon(true);

    // Play victory sound
    audioManager.playSFX("victory");

    // Disable gravity
    this.body.setAllowGravity(false);
    this.body.setVelocity(0, -50); // Gentle float upward

    // Golden glow effect
    const glow = this.scene.add.graphics();
    glow.fillStyle(COLORS.GRACE_ORB, 0.3);
    glow.fillCircle(this.x, this.y, 100);

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: 3,
      duration: 2000,
      ease: "Power2",
      onComplete: () => {
        glow.destroy();
      },
    });
  }

  public getState(): PlayerState {
    return this.playerState;
  }

  public destroy(fromScene?: boolean): void {
    this.flameParticles?.destroy();
    super.destroy(fromScene);
  }
}
