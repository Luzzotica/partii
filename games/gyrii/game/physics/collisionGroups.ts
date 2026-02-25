/**
 * Collision group bits; must match server collision_groups.rs.
 * Two bodies collide if (A.memberships & B.filter) != 0 && (B.memberships & A.filter) != 0.
 */
export const GROUP_BULLET = 1 << 0; // 1
export const GROUP_PLAYER = 1 << 1; // 2
export const GROUP_WALL = 1 << 2; // 4
export const GROUP_FLOOR = 1 << 3; // 8
export const GROUP_GRENADE = 1 << 4; // 16
export const GROUP_FLAG = 1 << 6; // 64

/** Pack membership and filter for Rapier setCollisionGroups (memberships in high 16 bits, filter in low). */
export function collisionGroups(memberships: number, filter: number): number {
  return (memberships << 16) | filter;
}
