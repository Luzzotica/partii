import * as BABYLON from "@babylonjs/core";
import {
  createMuzzleFlash,
  createExplosion,
  createFireEffect,
} from "../effects/ParticleEffects";
import type { CameraZoomConfig } from "../constants";
import {
  BULLET_SPEED,
  PROJECTILE_TTL_BULLET_SEC,
  PROJECTILE_TTL_ROCKET_SEC,
} from "../constants";
import {
  PROJECTILE_TYPE_BULLET,
  PROJECTILE_TYPE_ROCKET,
  type PhotonBeamEntry,
} from "../../store/gameStore";
import { PHOTON_BEAM_DURATION_TICKS, PHOTON_BEAM_RADIUS } from "../constants";

export type WeaponType =
  | "smg"
  | "dualMachineGun"
  | "chainGun"
  | "photonRifle"
  | "bazooka"
  | "flamethrower";

export interface WeaponConfig {
  type: WeaponType;
  name: string;
  fireRate: number; // shots per second
  damage: number;
  knockback: number;
  projectileSpeed?: number; // for projectile weapons
  isHitscan: boolean;
  ammoCapacity: number;
  reloadTime: number;
  /** Override camera zoom (distance-based) when this weapon is equipped. */
  cameraZoom?: CameraZoomConfig;
  /** Charge duration in ms (hold to fire); used by photon rifle. */
  chargeDurationMs?: number;
  /** Cooldown after fire before next charge can start (ms); photon rifle only. */
  rechargeAfterFireMs?: number;
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  smg: {
    type: "smg",
    name: "Submachine Gun",
    fireRate: 15,
    damage: 8,
    knockback: 0.5,
    isHitscan: true,
    ammoCapacity: 30,
    reloadTime: 1.5,
  },
  dualMachineGun: {
    type: "dualMachineGun",
    name: "Dual Machine Gun",
    fireRate: 20,
    damage: 6,
    knockback: 0.4,
    isHitscan: true,
    ammoCapacity: 40,
    reloadTime: 2,
  },
  chainGun: {
    type: "chainGun",
    name: "Chain Gun",
    fireRate: 30,
    damage: 5,
    knockback: 0.8,
    isHitscan: true,
    ammoCapacity: 100,
    reloadTime: 3,
  },
  photonRifle: {
    type: "photonRifle",
    name: "Photon Rifle",
    fireRate: 0.25,
    damage: 50,
    knockback: 2,
    isHitscan: true,
    ammoCapacity: 5,
    reloadTime: 2,
    cameraZoom: { radiusMin: 35, radiusMax: 50, mouseZoomMaxDist: 30 },
    chargeDurationMs: 1200,
    /** Cooldown after firing before next charge can start (ms); must match server. */
    rechargeAfterFireMs: 2000,
  },
  bazooka: {
    type: "bazooka",
    name: "Bazooka",
    fireRate: 1,
    damage: 80,
    knockback: 3,
    projectileSpeed: 20,
    isHitscan: false,
    ammoCapacity: 4,
    reloadTime: 2.5,
  },
  flamethrower: {
    type: "flamethrower",
    name: "Flamethrower",
    fireRate: 60,
    damage: 3,
    knockback: 0.2,
    isHitscan: false,
    ammoCapacity: 100,
    reloadTime: 2,
  },
};

/**
 * Renders weapon effects in the scene
 */
const BULLET_POOL_SIZE = 80;
const ROCKET_POOL_SIZE = 10;
const BEAM_POOL_SIZE = 8;
/** Match server capsule radius (BEAM_HALF_WIDTH) so visual = collider. */
const PHOTON_BEAM_DIAMETER = 2 * PHOTON_BEAM_RADIUS;

export class WeaponRenderer {
  private scene: BABYLON.Scene;
  private tracerPool: BABYLON.Mesh[] = [];
  private bulletPool: BABYLON.Mesh[] = [];
  private rocketPool: BABYLON.Mesh[] = [];
  private beamPool: BABYLON.Mesh[] = [];
  private projectiles: Map<
    string,
    {
      mesh: BABYLON.Mesh;
      velocity: BABYLON.Vector3;
      spawnTime: number;
      isRocket: boolean;
    }
  > = new Map();
  private flameEffects: Map<string, BABYLON.ParticleSystem> = new Map();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.initTracerPool();
    this.initBulletPool();
    this.initRocketPool();
    this.initBeamPool();
  }

  private initBeamPool() {
    for (let i = 0; i < BEAM_POOL_SIZE; i++) {
      const mesh = BABYLON.MeshBuilder.CreateCylinder(
        `beam_${i}`,
        { height: 1, diameter: PHOTON_BEAM_DIAMETER },
        this.scene,
      );
      mesh.isVisible = false;
      mesh.isPickable = false; // beams are visual only, no collision
      const mat = new BABYLON.StandardMaterial(`beamMat_${i}`, this.scene);
      mat.emissiveColor = new BABYLON.Color3(0, 1, 1);
      mat.disableLighting = true;
      mat.alpha = 1;
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      mesh.material = mat;
      this.beamPool.push(mesh);
    }
  }

  private initBulletPool() {
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      const mesh = BABYLON.MeshBuilder.CreateSphere(
        `pool_bullet_${i}`,
        { diameter: 0.16 },
        this.scene,
      );
      mesh.isVisible = false;
      const mat = new BABYLON.StandardMaterial(
        `pool_bullet_mat_${i}`,
        this.scene,
      );
      mat.emissiveColor = new BABYLON.Color3(1, 1, 0.5);
      mat.disableLighting = true;
      mesh.material = mat;
      this.bulletPool.push(mesh);
    }
  }

  private initRocketPool() {
    for (let i = 0; i < ROCKET_POOL_SIZE; i++) {
      const mesh = BABYLON.MeshBuilder.CreateSphere(
        `pool_rocket_${i}`,
        { diameter: 0.4 },
        this.scene,
      );
      mesh.isVisible = false;
      const mat = new BABYLON.PBRMaterial(`pool_rocket_mat_${i}`, this.scene);
      mat.emissiveColor = new BABYLON.Color3(1, 0.3, 0);
      mat.albedoColor = new BABYLON.Color3(1, 0.2, 0);
      mesh.material = mat;
      this.rocketPool.push(mesh);
    }
  }

  private initTracerPool() {
    // Pre-create tracer meshes for hitscan weapons
    for (let i = 0; i < 20; i++) {
      const tracer = BABYLON.MeshBuilder.CreateCylinder(
        `tracer_${i}`,
        { height: 2, diameter: 0.05 },
        this.scene,
      );
      tracer.isVisible = false;

      const material = new BABYLON.StandardMaterial(
        `tracerMat_${i}`,
        this.scene,
      );
      material.emissiveColor = new BABYLON.Color3(1, 1, 0);
      material.disableLighting = true;
      tracer.material = material;

      this.tracerPool.push(tracer);
    }
  }

  /**
   * Fire a hitscan weapon (SMG, Dual Machine Gun, Chain Gun, Photon Rifle)
   */
  fireHitscan(
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    config: WeaponConfig,
    hitCallback?: (
      hitPoint: BABYLON.Vector3,
      hitMesh?: BABYLON.AbstractMesh,
    ) => void,
  ) {
    // Muzzle flash
    createMuzzleFlash(this.scene, origin, direction);

    // Get a tracer from the pool
    const tracer = this.tracerPool.find((t) => !t.isVisible);
    if (tracer) {
      // Calculate end point (raycast)
      const ray = new BABYLON.Ray(origin, direction, 100);
      const hit = this.scene.pickWithRay(
        ray,
        (mesh) =>
          mesh.name !== "player" &&
          mesh.name !== "gridGround" &&
          !mesh.name.startsWith("weapon-") &&
          !mesh.name.startsWith("muzzle") &&
          !mesh.name.startsWith("debugAim-") &&
          !mesh.name.startsWith("beam_"),
      );

      const endPoint = hit?.pickedPoint || origin.add(direction.scale(100));

      // Position and orient tracer
      const midPoint = BABYLON.Vector3.Center(origin, endPoint);
      const length = BABYLON.Vector3.Distance(origin, endPoint);

      tracer.position = midPoint;
      tracer.scaling.y = length / 2;
      tracer.lookAt(endPoint);
      tracer.rotation.x += Math.PI / 2;

      // Set color based on weapon
      const material = tracer.material as BABYLON.StandardMaterial;
      switch (config.type) {
        case "photonRifle":
          material.emissiveColor = new BABYLON.Color3(0, 1, 1);
          break;
        default:
          material.emissiveColor = new BABYLON.Color3(1, 1, 0);
      }

      tracer.isVisible = true;

      // Hide tracer after short delay
      setTimeout(
        () => {
          tracer.isVisible = false;
        },
        config.type === "photonRifle" ? 200 : 50,
      );

      // Callback for hit
      if (hit?.pickedPoint && hitCallback) {
        hitCallback(hit.pickedPoint, hit.pickedMesh || undefined);
      }
    }
  }

  /**
   * Fire a projectile (single entry point for server events). Uses pool by projectileType.
   * For bullets we use server direction but apply BULLET_SPEED on the client so visuals
   * are not dependent on velocity being deserialized from the row.
   */
  fireProjectile(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    projectileType: number,
  ): string {
    const projectileId = `proj_${Date.now()}_${Math.random()}`;
    const isRocket = projectileType === PROJECTILE_TYPE_ROCKET;
    const pool = isRocket ? this.rocketPool : this.bulletPool;
    const mesh = pool.find((m) => !m.isVisible) ?? pool[pool.length - 1];
    mesh.position.set(position.x, position.y, position.z);
    mesh.isVisible = true;

    const vel = new BABYLON.Vector3(velocity.x, velocity.y, velocity.z);
    this.projectiles.set(projectileId, {
      mesh,
      velocity: vel,
      spawnTime: performance.now() / 1000,
      isRocket,
    });

    if (vel.lengthSquared() > 0.0001) {
      createMuzzleFlash(
        this.scene,
        mesh.position.clone(),
        vel.clone().normalize(),
      );
    }
    return projectileId;
  }

  /**
   * Fire a bullet (machine gun) - small, fast, with spray. Uses pool.
   */
  fireBullet(
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    config: WeaponConfig,
  ): string {
    const projectileId = `bullet_${Date.now()}_${Math.random()}`;
    const sprayRad = 0.12;
    const perpX = -direction.z;
    const perpZ = direction.x;
    const dir = direction.clone().normalize();
    dir.x += perpX * (Math.random() * 2 - 1) * sprayRad;
    dir.z += perpZ * (Math.random() * 2 - 1) * sprayRad;
    dir.normalize();

    const bullet =
      this.bulletPool.find((m) => !m.isVisible) ??
      this.bulletPool[this.bulletPool.length - 1];
    bullet.position.copyFrom(origin);
    bullet.isVisible = true;

    const velocity = dir.scale(BULLET_SPEED);
    this.projectiles.set(projectileId, {
      mesh: bullet,
      velocity,
      spawnTime: performance.now() / 1000,
      isRocket: false,
    });

    createMuzzleFlash(this.scene, origin, dir);
    return projectileId;
  }

  /**
   * Fire a rocket (Bazooka) from client. Uses pool.
   */
  fireRocket(
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    config: WeaponConfig,
    _ownerId: string,
  ): string {
    const speed = config.projectileSpeed ?? 20;
    const velocity = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed,
    };
    return this.fireProjectile(
      { x: origin.x, y: origin.y, z: origin.z },
      velocity,
      PROJECTILE_TYPE_ROCKET,
    );
  }

  /**
   * Detonate a projectile (for Bazooka click-to-detonate)
   */
  detonateProjectile(projectileId: string) {
    const entry = this.projectiles.get(projectileId);
    if (entry) {
      createExplosion(this.scene, entry.mesh.position, 4);
      entry.mesh.isVisible = false;
      this.projectiles.delete(projectileId);
    }
  }

  /**
   * Fire flamethrower (continuous effect)
   */
  startFlamethrower(
    playerId: string,
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
  ) {
    if (this.flameEffects.has(playerId)) return;

    const flame = createFireEffect(this.scene, origin, 3);

    // Orient flame in direction
    const angle = Math.atan2(direction.z, direction.x);
    (flame.emitter as BABYLON.Vector3).addInPlace(direction.scale(2));

    flame.start();
    this.flameEffects.set(playerId, flame);
  }

  /**
   * Stop flamethrower
   */
  stopFlamethrower(playerId: string) {
    const flame = this.flameEffects.get(playerId);
    if (flame) {
      flame.stop();
      setTimeout(() => flame.dispose(), 1000);
      this.flameEffects.delete(playerId);
    }
  }

  /**
   * Update flamethrower position/direction
   */
  updateFlamethrower(
    playerId: string,
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
  ) {
    const flame = this.flameEffects.get(playerId);
    if (flame) {
      (flame.emitter as BABYLON.Vector3).copyFrom(
        origin.add(direction.scale(2)),
      );
    }
  }

  /**
   * Update photon beam meshes from server state (call each frame with store beams).
   */
  updateBeams(beams: PhotonBeamEntry[]) {
    const pool = this.beamPool;
    const yUp = new BABYLON.Vector3(0, 1, 0);
    beams.forEach((beam, i) => {
      const mesh = pool[i];
      if (!mesh) return;
      const ox = beam.originX;
      const oy = beam.originY;
      const oz = beam.originZ;
      const ex = beam.endX;
      const ey = beam.endY;
      const ez = beam.endZ;
      const dx = ex - ox;
      const dy = ey - oy;
      const dz = ez - oz;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const midX = (ox + ex) * 0.5;
      const midY = (oy + ey) * 0.5;
      const midZ = (oz + ez) * 0.5;
      mesh.position.set(midX, midY, midZ);
      mesh.scaling.y = length;
      mesh.scaling.x = 1;
      mesh.scaling.z = 1;
      const dir = new BABYLON.Vector3(dx / length, dy / length, dz / length);
      let axis = BABYLON.Vector3.Cross(yUp, dir);
      if (axis.lengthSquared() < 1e-10) {
        axis =
          Math.abs(dir.y) < 0.99
            ? new BABYLON.Vector3(1, 0, 0)
            : new BABYLON.Vector3(0, 0, 1);
      }
      axis.normalize();
      const angle = Math.acos(BABYLON.Vector3.Dot(yUp, dir));
      if (!mesh.rotationQuaternion)
        mesh.rotationQuaternion = new BABYLON.Quaternion(0, 0, 0, 1);
      BABYLON.Quaternion.RotationAxisToRef(
        axis,
        angle,
        mesh.rotationQuaternion,
      );
      const remaining = beam.remainingTicks ?? PHOTON_BEAM_DURATION_TICKS;
      const alpha = Math.max(
        0,
        Math.min(1, remaining / PHOTON_BEAM_DURATION_TICKS),
      );
      const mat = mesh.material as BABYLON.StandardMaterial;
      if (mat) mat.alpha = alpha;
      mesh.isVisible = true;
    });
    for (let i = beams.length; i < pool.length; i++) {
      pool[i].isVisible = false;
    }
  }

  /**
   * Update all projectiles (call in render loop). TTL-based cleanup, return to pool.
   */
  update(deltaTime: number) {
    const projectilesToRemove: string[] = [];
    const now = performance.now() / 1000;

    this.projectiles.forEach((entry, id) => {
      entry.mesh.position.addInPlace(entry.velocity.scale(deltaTime));

      // TTL check (matches server)
      const ttl = entry.isRocket
        ? PROJECTILE_TTL_ROCKET_SEC
        : PROJECTILE_TTL_BULLET_SEC;
      if (now - entry.spawnTime >= ttl) {
        projectilesToRemove.push(id);
        return;
      }

      // Collision check (clone before normalize - normalize mutates in place)
      const velLen = entry.velocity.length();
      const ray = new BABYLON.Ray(
        entry.mesh.position,
        entry.velocity.clone().normalize(),
        velLen * deltaTime * 2,
      );
      const hit = this.scene.pickWithRay(
        ray,
        (mesh) =>
          mesh.isPickable &&
          mesh.name !== "player" &&
          mesh.name !== "gridGround" &&
          !mesh.name.startsWith("pool_") &&
          !mesh.name.startsWith("projectile") &&
          !mesh.name.startsWith("weapon-") &&
          !mesh.name.startsWith("muzzle") &&
          !mesh.name.startsWith("debugAim-") &&
          !mesh.name.startsWith("beam_"),
      );

      if (hit?.pickedMesh) {
        if (entry.isRocket) {
          createExplosion(this.scene, entry.mesh.position, 4);
        } else {
          createMuzzleFlash(
            this.scene,
            entry.mesh.position,
            entry.velocity.clone().normalize(),
          );
        }
        projectilesToRemove.push(id);
      }
    });

    projectilesToRemove.forEach((id) => {
      const entry = this.projectiles.get(id);
      if (entry) {
        entry.mesh.isVisible = false;
        this.projectiles.delete(id);
      }
    });
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.tracerPool.forEach((t) => t.dispose());
    this.bulletPool.forEach((m) => m.dispose());
    this.rocketPool.forEach((m) => m.dispose());
    this.beamPool.forEach((m) => m.dispose());
    this.projectiles.clear();
    this.flameEffects.forEach((f) => f.dispose());
  }
}
