/**
 * Weapon handler interface: same lifecycle contract as server (onInput / canFire / fire).
 * Client uses: getChargeProgress for charge visuals, onShotFired when server confirms a shot.
 */
import type * as BABYLON from "@babylonjs/core";
import {
  type WeaponConfig,
  type WeaponType,
  WEAPON_CONFIGS,
} from "./WeaponRenderer";
import type { WeaponRenderer } from "./WeaponRenderer";

export type { WeaponConfig, WeaponType };

/** Local state for charge weapons (e.g. photon rifle). */
export interface ChargeLocalState {
  chargeStartTime: number;
}

/** Client-side weapon handler: config + optional charge progress + shot feedback. */
export interface IWeaponHandler {
  readonly config: WeaponConfig;
  /** 0..1 while charging; only for charge weapons. */
  getChargeProgress?(localState: ChargeLocalState): number;
  /** Called when server confirms a shot (lastShotAt updated). */
  onShotFired(
    renderer: WeaponRenderer,
    position: BABYLON.Vector3,
    aim: BABYLON.Vector3,
  ): void;
}

function makeHitscanHandler(type: WeaponType): IWeaponHandler {
  const config = WEAPON_CONFIGS[type];
  return {
    config,
    onShotFired(renderer, position, aim) {
      renderer.fireHitscan(position, aim, config);
    },
  };
}

function makeBulletHandler(type: WeaponType): IWeaponHandler {
  const config = WEAPON_CONFIGS[type];
  return {
    config,
    onShotFired(renderer, position, aim) {
      renderer.fireBullet(position, aim, config);
    },
  };
}

function makePhotonRifleHandler(): IWeaponHandler {
  const config = WEAPON_CONFIGS.photonRifle;
  const chargeDurationMs = config.chargeDurationMs ?? 1200;
  return {
    config,
    getChargeProgress(localState) {
      if (!localState.chargeStartTime) return 0;
      const elapsed = performance.now() - localState.chargeStartTime;
      return Math.min(1, elapsed / chargeDurationMs);
    },
    onShotFired(_renderer, _position, _aim) {
      // No tracer/burst – beam is rendered from photon_beam table only
    },
  };
}

function makeBazookaHandler(): IWeaponHandler {
  const config = WEAPON_CONFIGS.bazooka;
  return {
    config,
    onShotFired(renderer, position, aim) {
      renderer.fireRocket(position, aim, config, "local");
    },
  };
}

export const WEAPON_HANDLERS: Record<WeaponType, IWeaponHandler> = {
  smg: makeBulletHandler("smg"),
  dualMachineGun: makeBulletHandler("dualMachineGun"),
  chainGun: makeBulletHandler("chainGun"),
  photonRifle: makePhotonRifleHandler(),
  bazooka: makeBazookaHandler(),
  flamethrower: makeHitscanHandler("flamethrower"),
};
