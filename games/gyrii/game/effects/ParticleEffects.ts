import * as BABYLON from "@babylonjs/core";

/** Create a particle-friendly texture from canvas (avoids WebGL base64/texImage2D issues) */
function createParticleTexture(
  scene: BABYLON.Scene,
  name: string,
): BABYLON.Texture {
  const size = 16;
  const tex = new BABYLON.DynamicTexture(
    name,
    { width: size, height: size },
    scene,
    false,
    BABYLON.Texture.NEAREST_SAMPLINGMODE,
  );
  tex.hasAlpha = true;
  tex.getContext().clearRect(0, 0, size, size);
  const ctx = tex.getContext();
  const cx = size / 2;
  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.8)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  return tex;
}

// Neon colors for tie-dye effect
const NEON_COLORS = [
  new BABYLON.Color4(0, 1, 1, 1), // Cyan
  new BABYLON.Color4(1, 0, 1, 1), // Magenta
  new BABYLON.Color4(1, 1, 0, 1), // Yellow
  new BABYLON.Color4(0, 1, 0.5, 1), // Spring Green
  new BABYLON.Color4(1, 0.5, 0, 1), // Orange
  new BABYLON.Color4(0.5, 0, 1, 1), // Purple
];

/**
 * Creates a tie-dye explosion effect at the given position
 */
export function createDeathExplosion(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  playerColor: BABYLON.Color3,
  onComplete?: () => void,
): BABYLON.ParticleSystem[] {
  const systems: BABYLON.ParticleSystem[] = [];

  // Main explosion particles
  const mainSystem = new BABYLON.ParticleSystem("deathExplosion", 500, scene);
  mainSystem.particleTexture = createParticleTexture(scene, "deathExplosion");

  // Emitter
  mainSystem.emitter = position.clone();
  mainSystem.minEmitBox = new BABYLON.Vector3(-0.5, -0.5, -0.5);
  mainSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0.5, 0.5);

  // Colors - blend player color with random neon colors for tie-dye effect
  const playerColor4 = new BABYLON.Color4(
    playerColor.r,
    playerColor.g,
    playerColor.b,
    1,
  );
  mainSystem.color1 = playerColor4;
  mainSystem.color2 =
    NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
  mainSystem.colorDead = new BABYLON.Color4(
    playerColor.r * 0.3,
    playerColor.g * 0.3,
    playerColor.b * 0.3,
    0,
  );

  // Size
  mainSystem.minSize = 0.2;
  mainSystem.maxSize = 0.8;
  mainSystem.minScaleX = 0.5;
  mainSystem.maxScaleX = 2;
  mainSystem.minScaleY = 0.5;
  mainSystem.maxScaleY = 2;

  // Lifetime
  mainSystem.minLifeTime = 0.5;
  mainSystem.maxLifeTime = 1.5;

  // Emission
  mainSystem.emitRate = 0;
  mainSystem.manualEmitCount = 200;

  // Speed
  mainSystem.minEmitPower = 5;
  mainSystem.maxEmitPower = 15;
  mainSystem.updateSpeed = 0.01;

  // Direction
  mainSystem.direction1 = new BABYLON.Vector3(-1, 1, -1);
  mainSystem.direction2 = new BABYLON.Vector3(1, 2, 1);

  // Gravity
  mainSystem.gravity = new BABYLON.Vector3(0, -3, 0);

  // Angular speed
  mainSystem.minAngularSpeed = -Math.PI;
  mainSystem.maxAngularSpeed = Math.PI;

  // Blend mode for glow effect
  mainSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  // Start
  mainSystem.start();
  systems.push(mainSystem);

  // Secondary sparkle particles
  const sparkleSystem = new BABYLON.ParticleSystem("deathSparkle", 100, scene);
  sparkleSystem.particleTexture = mainSystem.particleTexture;

  sparkleSystem.emitter = position.clone();
  sparkleSystem.minEmitBox = new BABYLON.Vector3(-0.3, -0.3, -0.3);
  sparkleSystem.maxEmitBox = new BABYLON.Vector3(0.3, 0.3, 0.3);

  // Colors - random neon
  const randomColor1 =
    NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
  const randomColor2 =
    NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
  sparkleSystem.color1 = randomColor1;
  sparkleSystem.color2 = randomColor2;
  sparkleSystem.colorDead = new BABYLON.Color4(1, 1, 1, 0);

  sparkleSystem.minSize = 0.05;
  sparkleSystem.maxSize = 0.2;

  sparkleSystem.minLifeTime = 0.3;
  sparkleSystem.maxLifeTime = 0.8;

  sparkleSystem.emitRate = 0;
  sparkleSystem.manualEmitCount = 100;

  sparkleSystem.minEmitPower = 10;
  sparkleSystem.maxEmitPower = 25;

  sparkleSystem.direction1 = new BABYLON.Vector3(-1, 0.5, -1);
  sparkleSystem.direction2 = new BABYLON.Vector3(1, 1.5, 1);

  sparkleSystem.gravity = new BABYLON.Vector3(0, -1, 0);

  sparkleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  sparkleSystem.start();
  systems.push(sparkleSystem);

  // Ring burst effect
  const ringSystem = new BABYLON.ParticleSystem("deathRing", 50, scene);
  ringSystem.particleTexture = mainSystem.particleTexture;

  ringSystem.emitter = position.clone();
  ringSystem.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1);
  ringSystem.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1);

  ringSystem.color1 = new BABYLON.Color4(1, 1, 1, 1);
  ringSystem.color2 = playerColor4;
  ringSystem.colorDead = new BABYLON.Color4(1, 1, 1, 0);

  ringSystem.minSize = 0.3;
  ringSystem.maxSize = 0.6;

  ringSystem.minLifeTime = 0.2;
  ringSystem.maxLifeTime = 0.4;

  ringSystem.emitRate = 0;
  ringSystem.manualEmitCount = 50;

  ringSystem.minEmitPower = 15;
  ringSystem.maxEmitPower = 20;

  // Horizontal burst
  ringSystem.direction1 = new BABYLON.Vector3(-1, 0.1, -1);
  ringSystem.direction2 = new BABYLON.Vector3(1, 0.3, 1);

  ringSystem.gravity = new BABYLON.Vector3(0, 0, 0);

  ringSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  ringSystem.start();
  systems.push(ringSystem);

  // Cleanup after effect completes
  setTimeout(() => {
    systems.forEach((system) => {
      system.stop();
      setTimeout(() => system.dispose(), 2000);
    });
    onComplete?.();
  }, 1500);

  return systems;
}

/**
 * Creates a muzzle flash effect
 */
export function createMuzzleFlash(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  direction: BABYLON.Vector3,
): BABYLON.ParticleSystem {
  const system = new BABYLON.ParticleSystem("muzzleFlash", 20, scene);
  system.particleTexture = createParticleTexture(scene, "muzzleFlash");

  system.emitter = position.clone();
  system.minEmitBox = new BABYLON.Vector3(-0.05, -0.05, -0.05);
  system.maxEmitBox = new BABYLON.Vector3(0.05, 0.05, 0.05);

  system.color1 = new BABYLON.Color4(1, 0.9, 0.5, 1);
  system.color2 = new BABYLON.Color4(1, 0.6, 0.2, 1);
  system.colorDead = new BABYLON.Color4(1, 0.3, 0, 0);

  system.minSize = 0.1;
  system.maxSize = 0.3;

  system.minLifeTime = 0.05;
  system.maxLifeTime = 0.15;

  system.emitRate = 0;
  system.manualEmitCount = 20;

  system.minEmitPower = 5;
  system.maxEmitPower = 10;

  system.direction1 = direction.scale(0.8);
  system.direction2 = direction.scale(1.2);

  system.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  system.start();

  setTimeout(() => {
    system.stop();
    setTimeout(() => system.dispose(), 500);
  }, 100);

  return system;
}

/**
 * Creates an explosion effect (for grenades/rockets)
 */
export function createExplosion(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  radius: number = 3,
): BABYLON.ParticleSystem[] {
  const systems: BABYLON.ParticleSystem[] = [];

  // Fire/smoke
  const fireSystem = new BABYLON.ParticleSystem("explosion", 300, scene);
  fireSystem.particleTexture = createParticleTexture(scene, "explosion");

  fireSystem.emitter = position.clone();
  fireSystem.minEmitBox = new BABYLON.Vector3(
    -radius * 0.2,
    -radius * 0.1,
    -radius * 0.2,
  );
  fireSystem.maxEmitBox = new BABYLON.Vector3(
    radius * 0.2,
    radius * 0.2,
    radius * 0.2,
  );

  fireSystem.color1 = new BABYLON.Color4(1, 0.5, 0, 1);
  fireSystem.color2 = new BABYLON.Color4(1, 0.2, 0, 1);
  fireSystem.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0);

  fireSystem.minSize = radius * 0.2;
  fireSystem.maxSize = radius * 0.5;

  fireSystem.minLifeTime = 0.3;
  fireSystem.maxLifeTime = 0.8;

  fireSystem.emitRate = 0;
  fireSystem.manualEmitCount = 200;

  fireSystem.minEmitPower = radius * 2;
  fireSystem.maxEmitPower = radius * 5;

  fireSystem.direction1 = new BABYLON.Vector3(-1, 1, -1);
  fireSystem.direction2 = new BABYLON.Vector3(1, 3, 1);

  fireSystem.gravity = new BABYLON.Vector3(0, -2, 0);

  fireSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  fireSystem.start();
  systems.push(fireSystem);

  // Cleanup
  setTimeout(() => {
    systems.forEach((system) => {
      system.stop();
      setTimeout(() => system.dispose(), 1000);
    });
  }, 500);

  return systems;
}

/**
 * Creates fire/burn effect (for molotov)
 */
export function createFireEffect(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  radius: number = 2,
): BABYLON.ParticleSystem {
  const system = new BABYLON.ParticleSystem("fire", 100, scene);
  system.particleTexture = createParticleTexture(scene, "fire");

  system.emitter = position.clone();
  system.minEmitBox = new BABYLON.Vector3(-radius, 0, -radius);
  system.maxEmitBox = new BABYLON.Vector3(radius, 0.1, radius);

  system.color1 = new BABYLON.Color4(1, 0.5, 0, 1);
  system.color2 = new BABYLON.Color4(1, 0.8, 0, 1);
  system.colorDead = new BABYLON.Color4(0.5, 0.2, 0, 0);

  system.minSize = 0.3;
  system.maxSize = 0.8;

  system.minLifeTime = 0.5;
  system.maxLifeTime = 1;

  system.emitRate = 50;

  system.minEmitPower = 1;
  system.maxEmitPower = 3;

  system.direction1 = new BABYLON.Vector3(-0.2, 1, -0.2);
  system.direction2 = new BABYLON.Vector3(0.2, 2, 0.2);

  system.gravity = new BABYLON.Vector3(0, 0, 0);

  system.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  return system;
}

/** Unique id for death decal names */
let deathDecalCounter = 0;

/**
 * Creates a decal on the ground mesh at the given position in the player's main color.
 * Uses Babylon's mesh decal projected onto the scene's "ground" mesh.
 * Returns the decal mesh, or null if ground mesh is not found.
 */
export function createDeathDecal(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  mainColor: BABYLON.Color3,
): BABYLON.Mesh | null {
  const ground = scene.getMeshByName("ground") as BABYLON.Mesh | undefined;
  if (!ground) return null;

  const name = `deathDecal-${deathDecalCounter++}`;
  const decalPosition = new BABYLON.Vector3(position.x, 0, position.z);
  const normal = new BABYLON.Vector3(0, -1, 0);
  const size = new BABYLON.Vector3(1, 1, 1);
  const angle = (Math.random() - 0.5) * Math.PI * 0.5;

  const decal = BABYLON.MeshBuilder.CreateDecal(name, ground, {
    position: decalPosition,
    normal,
    size,
    angle,
  });
  if (!decal) return null;

  const texSize = 64;
  const texture = new BABYLON.DynamicTexture(
    `${name}-tex`,
    { width: texSize, height: texSize },
    scene,
    false,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  const cx = texSize / 2;
  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  const r = Math.round(mainColor.r * 255);
  const g = Math.round(mainColor.g * 255);
  const b = Math.round(mainColor.b * 255);
  gradient.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
  gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.7)`);
  gradient.addColorStop(0.7, `rgba(${r},${g},${b},0.3)`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, texSize, texSize);
  texture.update();

  const mat = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.opacityTexture = texture;
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  mat.alpha = 0.98;
  decal.material = mat;

  return decal;
}
