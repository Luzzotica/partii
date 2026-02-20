import * as BABYLON from "@babylonjs/core";
import {
  createExplosion,
  createFireEffect,
  createGrenadeTrail,
} from "../effects/ParticleEffects";
import {
  createThrowableBody,
  getThrowablePosition,
  removeThrowableBody,
  setThrowableState,
  type WorldHandle,
} from "../physics";

export type ThrowableType = "grenade" | "molotov";

export interface ThrowableConfig {
  type: ThrowableType;
  damage: number;
  radius: number;
  fuseTime: number; // seconds
  bounceRestitution: number;
}

export const THROWABLE_CONFIGS: Record<ThrowableType, ThrowableConfig> = {
  grenade: {
    type: "grenade",
    damage: 1200,
    radius: 5,
    fuseTime: 6, // Server controls fuse; client removes on delete event
    bounceRestitution: 0.75,
  },
  molotov: {
    type: "molotov",
    damage: 15, // per second
    radius: 4,
    fuseTime: 0, // explodes on impact
    bounceRestitution: 0,
  },
};

interface ActiveThrowable {
  mesh: BABYLON.Mesh;
  config: ThrowableConfig;
  spawnTime: number;
  ownerId: string;
  /** Molotov: true once we've triggered fire on impact. */
  impactTriggered?: boolean;
  /** Server grenades: trailing particle system, emitter updated each position sync. */
  trailParticles?: BABYLON.ParticleSystem;
  /** Grenades: small ground shadow disc for visibility. */
  shadowMesh?: BABYLON.Mesh;
}

interface ActiveFireZone {
  position: BABYLON.Vector3;
  radius: number;
  endTime: number;
  particleSystem: BABYLON.ParticleSystem;
  zoneMesh: BABYLON.Mesh;
}

/**
 * Renders grenades and molotovs. Physics (gravity, walls, floor) is handled by the client Rapier world.
 */
export class ThrowableRenderer {
  private scene: BABYLON.Scene;
  private physicsHandle: WorldHandle;
  private glowLayer?: BABYLON.GlowLayer;
  private throwables: Map<string, ActiveThrowable> = new Map();
  private fireZones: Map<string, ActiveFireZone> = new Map();

  constructor(
    scene: BABYLON.Scene,
    physicsHandle: WorldHandle,
    glowLayer?: BABYLON.GlowLayer,
  ) {
    this.scene = scene;
    this.physicsHandle = physicsHandle;
    this.glowLayer = glowLayer;
  }

  /**
   * Throw a grenade or molotov. Creates a Rapier dynamic body and a mesh; position is driven by physics each frame.
   */
  throw(
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    throwStrength: number,
    type: ThrowableType,
    ownerId: string,
  ): string {
    const id = `throwable_${Date.now()}_${Math.random()}`;
    const config = THROWABLE_CONFIGS[type];

    const radius = type === "grenade" ? 0.15 : 0.125;
    const x = origin.x;
    const y = origin.y + 0.5;
    const z = origin.z;
    const arcHeight = 5 * (throwStrength / 20);
    const vx = direction.x * throwStrength;
    const vy = arcHeight;
    const vz = direction.z * throwStrength;

    createThrowableBody(this.physicsHandle, id, x, y, z, vx, vy, vz, radius, 1);

    const mesh = BABYLON.MeshBuilder.CreateSphere(
      id,
      { diameter: radius * 2 },
      this.scene,
    );
    mesh.position.set(x, y, z);

    const material = new BABYLON.StandardMaterial(`${id}_mat`, this.scene);
    if (type === "grenade") {
      material.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.2);
      material.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.1);
    } else {
      material.diffuseColor = new BABYLON.Color3(0.8, 0.3, 0.1);
      material.emissiveColor = new BABYLON.Color3(0.4, 0.15, 0.05);
    }
    mesh.material = material;

    this.throwables.set(id, {
      mesh,
      config,
      spawnTime: Date.now(),
      ownerId,
    });

    return id;
  }

  /**
   * Spawn a grenade from server state. Creates a client-side physics body for
   * prediction (bouncing); server updates reconcile position/velocity.
   */
  throwFromServer(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    rigidBodyId: number,
    ownerId: string,
    ownerColor?: { r: number; g: number; b: number },
  ): void {
    const id = `grenade_${rigidBodyId}`;
    if (this.throwables.has(id)) return;
    const config = THROWABLE_CONFIGS.grenade;
    const radius = 0.15;
    createThrowableBody(
      this.physicsHandle,
      id,
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      radius,
      1, // gravityScale
      0.75, // restitution (bounce)
    );
    const mesh = BABYLON.MeshBuilder.CreateSphere(
      id,
      { diameter: radius * 2 },
      this.scene,
    );
    mesh.position.set(position.x, position.y, position.z);
    const material = new BABYLON.StandardMaterial(`${id}_mat`, this.scene);
    // Glowing orb: use owner color or neutral white; emissive creates glow
    const r = ownerColor?.r ?? 0.9;
    const g = ownerColor?.g ?? 0.9;
    const b = ownerColor?.b ?? 0.95;
    material.diffuseColor = new BABYLON.Color3(r, g, b);
    material.emissiveColor = new BABYLON.Color3(r, g, b);
    mesh.material = material;
    this.glowLayer?.addIncludedOnlyMesh(mesh);

    const trailParticles = createGrenadeTrail(
      this.scene,
      new BABYLON.Vector3(position.x, position.y, position.z),
      ownerColor,
    );

    // Small ground shadow for visibility
    const shadowMesh = BABYLON.MeshBuilder.CreateDisc(
      `${id}_shadow`,
      { radius: 0.25, tessellation: 16 },
      this.scene,
    );
    shadowMesh.rotation.x = Math.PI / 2; // lay flat on XZ plane
    shadowMesh.position.set(position.x, 0.05, position.z);
    const shadowMat = new BABYLON.StandardMaterial(
      `${id}_shadow_mat`,
      this.scene,
    );
    shadowMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    shadowMat.alpha = 0.5;
    shadowMat.disableLighting = true;
    shadowMesh.material = shadowMat;

    this.throwables.set(id, {
      mesh,
      config,
      spawnTime: Date.now(),
      ownerId,
      trailParticles,
      shadowMesh,
    });
  }

  /**
   * Reconcile grenade physics body from server (position + velocity).
   */
  updateServerGrenadePosition(
    rigidBodyId: number,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
  ): void {
    const id = `grenade_${rigidBodyId}`;
    setThrowableState(
      this.physicsHandle,
      id,
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
    );
  }

  /**
   * Remove a server grenade (exploded). Returns last known position for explosion FX.
   */
  removeServerGrenade(
    rigidBodyId: number,
  ): { x: number; y: number; z: number } | null {
    const id = `grenade_${rigidBodyId}`;
    const throwable = this.throwables.get(id);
    if (!throwable) return null;
    const pos = getThrowablePosition(this.physicsHandle, id) ?? {
      x: throwable.mesh.position.x,
      y: throwable.mesh.position.y,
      z: throwable.mesh.position.z,
    };
    removeThrowableBody(this.physicsHandle, id);
    if (throwable.trailParticles) {
      throwable.trailParticles.stop();
      throwable.trailParticles.dispose();
    }
    throwable.shadowMesh?.dispose();
    this.glowLayer?.removeIncludedOnlyMesh(throwable.mesh);
    throwable.mesh.dispose();
    this.throwables.delete(id);
    return pos;
  }

  /**
   * Update all throwables: read position from Rapier, set mesh; handle fuse/impact removal.
   */
  update(_deltaTime: number) {
    const currentTime = Date.now();
    const toRemove: string[] = [];

    this.throwables.forEach((throwable, id) => {
      // All throwables (incl. server grenades) use client physics; server reconciles via updates
      const pos = getThrowablePosition(this.physicsHandle, id);
      if (!pos) {
        toRemove.push(id);
        return;
      }
      throwable.mesh.position.set(pos.x, pos.y, pos.z);
      if (throwable.trailParticles) {
        throwable.trailParticles.emitter = new BABYLON.Vector3(
          pos.x,
          pos.y,
          pos.z,
        );
      }
      if (throwable.shadowMesh) {
        throwable.shadowMesh.position.set(pos.x, 0.05, pos.z);
      }

      // Molotov: trigger fire on first impact (near floor)
      if (throwable.config.type === "molotov") {
        if (!throwable.impactTriggered && pos.y <= 0.2) {
          throwable.impactTriggered = true;
          this.createFireZone(
            new BABYLON.Vector3(pos.x, pos.y, pos.z),
            throwable.config.radius,
            5000,
          );
          toRemove.push(id);
        }
      }

      // Grenade: local fuse only for client-spawned (molotov uses impact); server grenades removed via removeServerGrenade
      if (throwable.config.type === "grenade" && !id.startsWith("grenade_")) {
        const elapsed = (currentTime - throwable.spawnTime) / 1000;
        if (elapsed >= throwable.config.fuseTime) {
          createExplosion(
            this.scene,
            throwable.mesh.position.clone(),
            throwable.config.radius * 0.8,
          );
          toRemove.push(id);
        }
      }
    });

    toRemove.forEach((id) => {
      removeThrowableBody(this.physicsHandle, id);
      const throwable = this.throwables.get(id);
      if (throwable) {
        throwable.shadowMesh?.dispose();
        throwable.mesh.dispose();
        this.throwables.delete(id);
      }
    });

    // Update fire zones
    const zonesToRemove: string[] = [];
    this.fireZones.forEach((zone, id) => {
      if (currentTime > zone.endTime) {
        zone.particleSystem.stop();
        setTimeout(() => {
          zone.particleSystem.dispose();
          zone.zoneMesh.dispose();
        }, 1000);
        zonesToRemove.push(id);
      }
    });
    zonesToRemove.forEach((id) => this.fireZones.delete(id));
  }

  private createFireZone(
    position: BABYLON.Vector3,
    radius: number,
    duration: number,
  ) {
    const id = `fire_${Date.now()}`;

    // Create visual zone on ground
    const zoneMesh = BABYLON.MeshBuilder.CreateDisc(
      id,
      { radius: radius },
      this.scene,
    );
    zoneMesh.position = new BABYLON.Vector3(position.x, 0.02, position.z);
    zoneMesh.rotation.x = Math.PI / 2;

    const material = new BABYLON.StandardMaterial(`${id}_mat`, this.scene);
    material.diffuseColor = new BABYLON.Color3(1, 0.3, 0);
    material.emissiveColor = new BABYLON.Color3(0.5, 0.15, 0);
    material.alpha = 0.5;
    zoneMesh.material = material;

    // Create fire particles
    const particleSystem = createFireEffect(this.scene, position, radius);
    particleSystem.start();

    this.fireZones.set(id, {
      position,
      radius,
      endTime: Date.now() + duration,
      particleSystem,
      zoneMesh,
    });
  }

  /**
   * Check if a position is in any fire zone
   */
  isInFireZone(position: BABYLON.Vector3): boolean {
    for (const [, zone] of this.fireZones) {
      const dist = BABYLON.Vector3.Distance(
        new BABYLON.Vector3(position.x, 0, position.z),
        new BABYLON.Vector3(zone.position.x, 0, zone.position.z),
      );
      if (dist <= zone.radius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all positions of active throwables (for other clients to render)
   */
  getThrowablePositions(): Array<{
    id: string;
    position: BABYLON.Vector3;
    type: ThrowableType;
  }> {
    const positions: Array<{
      id: string;
      position: BABYLON.Vector3;
      type: ThrowableType;
    }> = [];
    this.throwables.forEach((throwable, id) => {
      positions.push({
        id,
        position: throwable.mesh.position.clone(),
        type: throwable.config.type,
      });
    });
    return positions;
  }

  /**
   * Dispose all resources
   */
  dispose() {
    this.throwables.forEach((t) => t.mesh.dispose());
    this.fireZones.forEach((z) => {
      z.particleSystem.dispose();
      z.zoneMesh.dispose();
    });
  }
}
