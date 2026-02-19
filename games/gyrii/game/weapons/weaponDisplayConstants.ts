/**
 * Per-weapon display config: offset and rotation when attached to the player root.
 * Root faces aim direction (-Z forward); these are in root local space.
 */

export type WeaponTemplateKey = "dualMachineGun" | "photonRifle";

export interface WeaponDisplayConfig {
  /** Local position from player root (Z negative = in front of player). */
  offset: { x: number; y: number; z: number };
  /** Local rotation in radians to align model with aim (Y = yaw, X = pitch, Z = roll). Flip sign if weapon faces backward. */
  rotation?: { x?: number; y?: number; z?: number };
  /** Per-axis scale (default 1,1,1 if omitted). */
  scale?: { x: number; y: number; z: number };
  /**
   * Muzzle position in weapon local space (barrel tip for bullets/muzzle flash).
   * Weapon faces -Z when aiming; typically z &lt; 0 (in front). Used as child node offset and must match server.
   */
  muzzleOffset: { x: number; y: number; z: number };
}

const DEG = Math.PI / 180;

export const WEAPON_DISPLAY_CONFIG: Record<
  WeaponTemplateKey,
  WeaponDisplayConfig
> = {
  dualMachineGun: {
    offset: { x: 0.5, y: 0.125, z: -0.35 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.3, y: 1, z: 1 },
    muzzleOffset: { x: 1, y: 0, z: 0 },
  },
  photonRifle: {
    offset: { x: 0.5, y: 0.25, z: 0 },
    rotation: { y: 0 * DEG },
    scale: { x: 1, y: 1, z: 1 },
    muzzleOffset: { x: 0, y: 0.05, z: -0.35 },
  },
};

/** Default config when template key is missing (e.g. fallback to dualMachineGun). */
export const DEFAULT_WEAPON_DISPLAY_CONFIG: WeaponDisplayConfig = {
  offset: { x: 0.5, y: 0.25, z: 0 },
  rotation: { y: 135 * DEG },
  muzzleOffset: { x: 0, y: 0, z: -0.2 },
};

export function getWeaponDisplayConfig(
  templateKey: string,
): WeaponDisplayConfig {
  const key = templateKey as WeaponTemplateKey;
  return WEAPON_DISPLAY_CONFIG[key] ?? DEFAULT_WEAPON_DISPLAY_CONFIG;
}
