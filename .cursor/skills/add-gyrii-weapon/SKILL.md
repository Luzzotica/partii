---
name: add-gyrii-weapon
description: Add a new weapon to the gyrii game. Use when the user wants to create a new weapon, add weapon types, or extend the weapon system. Covers proto, server (Rust), and client (TypeScript) changes.
---

# Adding a New Weapon to Gyrii

When adding a weapon, touch these locations in order. Use the shotgun implementation as reference.

## Checklist (all required)

- [ ] Proto enum (common.proto)
- [ ] Server: state, weapon_config, weapon handler, actions, ws decode, sync
- [ ] Regenerate proto (buf generate)
- [ ] Client: store, constants, WeaponRenderer, WeaponHandler, SpawnLoadoutScreen
- [ ] Client: useGyriiServer, gyriiClient, weaponDisplayConstants
- [ ] Client: Game.tsx (getWeaponTemplateKey, createWeaponMesh if custom visual)
- [ ] Client: lobbySubscriptions/projectiles (if projectile type)

---

## 1. Proto

**File:** `games/gyrii/proto/common.proto`

Add to `WeaponType` enum (use next available number):

```protobuf
WEAPON_SHOTGUN = 7;
```

---

## 2. Regenerate Proto

```bash
cd games/gyrii && npx buf generate
```

---

## 3. Server (Rust)

### 3.1 State

**File:** `games/gyrii/server/src/state/player.rs`

Add variant to `WeaponType` enum:

```rust
Shotgun,
```

### 3.2 Weapon Config

**File:** `games/gyrii/server/src/weapon_config.rs`

Add config in `weapon_config()`:

```rust
static SHOTGUN: WeaponConfig = WeaponConfig {
    name: "shotgun",
    damage: 27,
    fire_rate_ms: 900,
    muzzle_offset: (-0.38, 0.125, -0.7),
    photon: None,
    projectile: Some(SHOTGUN_PROJECTILE),  // or BULLET_PROJECTILE for single-projectile
};
// In match:
Shotgun => &SHOTGUN,
```

For pellet weapons, define a `ProjectileConfig` with `pellets: Some(6)`.

### 3.3 Weapon Handler (critical)

Weapon fire logic lives in **`games/gyrii/server/src/combat/weapons/`**.

**For single-projectile weapons** (SMG, ChainGun, Bazooka, Flamethrower): add the weapon to `weapon_config` only. The `bullet.rs` handler already supports all projectile weapons via config.

**For custom firing logic** (shotgun, photon rifle): create a new handler file and register it.

**File:** `games/gyrii/server/src/combat/weapons/shotgun.rs` (or `my_weapon.rs`)

```rust
// Copy from shotgun.rs: try_fire(state, lobby_id, identity) -> Vec<ShotEventPayload>
pub fn try_fire(state: &mut ServerState, lobby_id: u64, identity: &str) -> Vec<ShotEventPayload> { ... }
```

**File:** `games/gyrii/server/src/combat/weapons/mod.rs`

Add to the `match weapon` dispatch:

```rust
WeaponType::Shotgun => shotgun::try_fire(state, lobby_id, identity),
```

For **beam/hitscan** weapons (like photon rifle): create `photon_rifle.rs`-style handler that returns `Vec::new()` (no shot events; damage is applied per-tick elsewhere).

### 3.4 Actions

**File:** `games/gyrii/server/src/actions/player.rs`

Add to `parse_weapon`:

```rust
"Shotgun" => WeaponType::Shotgun,
```

### 3.5 WS Client Decode

**File:** `games/gyrii/server/src/ws/client_decode.rs`

Add to `weapon_to_pascal`:

```rust
Ok(WeaponType::WeaponShotgun) => "Shotgun",
```

### 3.6 Sync

**File:** `games/gyrii/server/src/sync.rs`

- Add `WeaponType::Shotgun` case in `weapon_to_proto`
- Add `"shotgun"` case in `weapon_str_to_proto`

---

## 4. Client (TypeScript)

### 4.1 Store

**File:** `games/gyrii/store/gameStore.ts`

Add to `WeaponType` union:

```ts
| "shotgun"
```

### 4.2 Weapon Config

**File:** `games/gyrii/game/weapons/WeaponRenderer.ts`

- Add to `WeaponType` union
- Add entry in `WEAPON_CONFIGS` with: type, name, fireRate, damage, knockback, isHitscan, ammoCapacity, reloadTime, plus optional projectileSpeed, chargeDurationMs, etc.

### 4.3 Weapon Handler (critical)

**File:** `games/gyrii/game/weapons/WeaponHandler.ts`

Add handler and register in `WEAPON_HANDLERS`:

```ts
function makeShotgunHandler(): IWeaponHandler {
  const config = WEAPON_CONFIGS.shotgun;
  return {
    config,
    onShotFired() { /* pellets from server */ },
  };
}
// In WEAPON_HANDLERS:
shotgun: makeShotgunHandler(),
```

Use `makeBulletHandler`, `makeHitscanHandler`, `makeBazookaHandler`, or `makePhotonRifleHandler` as patterns. **Without this, `WEAPON_HANDLERS[weapon]` is undefined → crash on `getChargeProgress`.**

### 4.4 Spawn Loadout Screen

**File:** `games/gyrii/components/SpawnLoadoutScreen.tsx`

Add to `PRIMARY_OPTIONS`:

```ts
{ value: "shotgun", label: "Shotgun" },
```

### 4.5 useGyriiServer

**File:** `games/gyrii/hooks/useGyriiServer.ts`

Add to weapon proto→str mapping:

```ts
[ProtoWeaponType.WEAPON_SHOTGUN]: "shotgun",
```

### 4.6 gyriiClient

**File:** `games/gyrii/services/gyriiClient.ts`

- Add `"shotgun"` to `requestSpawn` weapon union
- Add `shotgun: WeaponType.WEAPON_SHOTGUN` in `weaponToProto` record

### 4.7 Weapon Display (visual)

**File:** `games/gyrii/game/weapons/weaponDisplayConstants.ts`

- Add `"shotgun"` to `WeaponTemplateKey`
- Add `shotgun: { offset, rotation?, scale?, muzzleOffset }` in `WEAPON_DISPLAY_CONFIG`

### 4.8 Game.tsx

**File:** `games/gyrii/components/Game.tsx`

- In `getWeaponTemplateKey`, add branch for the new weapon (map to existing GLB or custom)
- If reusing a model (e.g. dual machine gun): `weapon === "shotgun" ? "shotgun" : ...`
- If custom visual: load template and optionally add special handling in `createWeaponMesh` (e.g. shotgun = 2× machine_gun clones side by side)

### 4.9 Projectiles (if projectile weapon)

**File:** `games/gyrii/hooks/lobbySubscriptions/projectiles.ts`

Map `projectileType` to weapon for pool:

```ts
projectileType === 2 ? "shotgun" : ...
```

**File:** `games/gyrii/game/constants.ts`

If new projectile type with different TTL:

```ts
export const PROJECTILE_TTL_SHOTGUN_SEC = 0.5;
```

**File:** `games/gyrii/game/weapons/WeaponRenderer.ts`

- Add `PROJECTILE_TYPE_SHOTGUN` import from store
- In projectile entry, add `isShotgun: boolean`
- In TTL check: use `PROJECTILE_TTL_SHOTGUN_SEC` when `isShotgun`

---

## 5. Special Cases

### Single-projectile weapons (SMG, ChainGun, Bazooka, Flamethrower)

- Add config to `weapon_config.rs` only. The `bullet.rs` handler covers all such weapons.
- No new handler file needed.

### Projectile weapon with multiple pellets (shotgun)

- Create `combat/weapons/shotgun.rs` with `try_fire` that spawns N projectiles, returns `Vec<ShotEventPayload>` with N events
- Register in `combat/weapons/mod.rs`
- Client: `onShotFired` no-op; pellets come from server `shot_events`

### Beam/hitscan weapons (photon rifle)

- Create `combat/weapons/photon_rifle.rs` that spawns a beam, returns `Vec::new()`
- Damage is applied per-tick in `combat::process_photon_beam_damage` (extend if new beam type)

### Damage falloff

- `ProjectileData` already has `origin_x, origin_y, origin_z`
- `process_projectile_collisions` applies S-curve multiplier via `ProjectileConfig.falloff_range` and `falloff_k`
- Set `falloff_range: 0` to disable

### Custom weapon model

- Load GLB in Game.tsx `loadWeapon("my_weapon.glb", "myWeapon")`
- Ensure `getWeaponTemplateKey` returns the template key
