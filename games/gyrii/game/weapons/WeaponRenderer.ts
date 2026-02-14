import * as BABYLON from "@babylonjs/core";
import {
  createMuzzleFlash,
  createExplosion,
  createFireEffect,
} from "../effects/ParticleEffects";
import type { CameraZoomConfig } from "../constants";

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
    fireRate: 0.5,
    damage: 50,
    knockback: 2,
    isHitscan: true,
    ammoCapacity: 5,
    reloadTime: 2,
    cameraZoom: { radiusMin: 35, radiusMax: 50, mouseZoomMaxDist: 30 },
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
export class WeaponRenderer {
  private scene: BABYLON.Scene;
  private tracerPool: BABYLON.Mesh[] = [];
  private projectiles: Map<
    string,
    { mesh: BABYLON.Mesh; velocity: BABYLON.Vector3 }
  > = new Map();
  private flameEffects: Map<string, BABYLON.ParticleSystem> = new Map();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.initTracerPool();
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
        (mesh) => mesh.name !== "player" && mesh.name !== "gridGround",
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
   * Fire a projectile weapon (Bazooka)
   */
  fireProjectile(
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    config: WeaponConfig,
    ownerId: string,
  ): string {
    const projectileId = `projectile_${Date.now()}_${Math.random()}`;

    // Create projectile mesh
    const projectile = BABYLON.MeshBuilder.CreateSphere(
      projectileId,
      { diameter: 0.4 },
      this.scene,
    );
    projectile.position = origin.clone();

    const material = new BABYLON.PBRMaterial(`${projectileId}_mat`, this.scene);
    material.emissiveColor = new BABYLON.Color3(1, 0.3, 0);
    material.albedoColor = new BABYLON.Color3(1, 0.2, 0);
    projectile.material = material;

    // Store projectile with velocity
    const velocity = direction.scale(config.projectileSpeed || 20);
    this.projectiles.set(projectileId, { mesh: projectile, velocity });

    // Muzzle flash
    createMuzzleFlash(this.scene, origin, direction);

    return projectileId;
  }

  /**
   * Detonate a projectile (for Bazooka click-to-detonate)
   */
  detonateProjectile(projectileId: string) {
    const projectile = this.projectiles.get(projectileId);
    if (projectile) {
      // Create explosion effect
      createExplosion(this.scene, projectile.mesh.position, 4);

      // Remove projectile
      projectile.mesh.dispose();
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
   * Update all projectiles (call in render loop)
   */
  update(deltaTime: number) {
    const projectilesToRemove: string[] = [];

    this.projectiles.forEach((projectile, id) => {
      // Move projectile
      projectile.mesh.position.addInPlace(projectile.velocity.scale(deltaTime));

      // Check for collision
      const ray = new BABYLON.Ray(
        projectile.mesh.position,
        projectile.velocity.normalize(),
        projectile.velocity.length() * deltaTime * 2,
      );
      const hit = this.scene.pickWithRay(
        ray,
        (mesh) =>
          mesh.name !== "player" &&
          mesh.name !== "gridGround" &&
          !mesh.name.startsWith("projectile"),
      );

      if (hit?.pickedMesh) {
        // Explode on impact
        createExplosion(this.scene, projectile.mesh.position, 4);
        projectilesToRemove.push(id);
      }

      // Check if out of bounds
      if (projectile.mesh.position.length() > 200) {
        projectilesToRemove.push(id);
      }
    });

    // Clean up removed projectiles
    projectilesToRemove.forEach((id) => {
      const projectile = this.projectiles.get(id);
      if (projectile) {
        projectile.mesh.dispose();
        this.projectiles.delete(id);
      }
    });
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.tracerPool.forEach((t) => t.dispose());
    this.projectiles.forEach((p) => p.mesh.dispose());
    this.flameEffects.forEach((f) => f.dispose());
  }
}
