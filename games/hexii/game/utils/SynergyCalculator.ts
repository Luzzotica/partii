/**
 * SynergyCalculator - Centralized synergy calculation for the Hexii game
 * 
 * This file handles all synergy calculations and provides easy-to-use
 * methods for checking active synergies and their effects.
 */

import type { HexColor, HexModule } from '../../store/gameStore';
import { HexGrid, type HexCoord } from './HexGrid';
import { HEX_SIZE } from '../config';
import { BASE_HEX_STATS, SYNERGY_VALUES } from '../config/SynergyConfig';

// ============================================================================
// TYPES
// ============================================================================

export type RingOfPerfectionType = 
  | 'OMNI_TURRET'   // RED: 360 firing arc
  | 'AEGIS'         // BLUE: Damage immunity pulses
  | 'CHRONOS'       // YELLOW: Slow time on dash
  | 'YGGDRASIL'     // GREEN: Full regen burst
  | 'SINGULARITY'   // CYAN: Black hole on level up
  | 'JUGGERNAUT';   // ORANGE: Unstoppable charge

export interface SynergyEffect {
  type: string;
  value: number; // Stacking count
  description: string;
  neighborColor: HexColor;
}

export interface HexSynergies {
  hex: HexModule;
  coord: HexCoord;
  synergies: SynergyEffect[];
  ringOfPerfection?: RingOfPerfectionType;
}

// Calculated stats from synergies
export interface SynergyStats {
  // Regen rates
  hpRegenRate: number;
  shieldRegenRate: number;
  
  // Movement
  moveSpeedMultiplier: number;
  hasDash: boolean;
  
  // Pickup
  pickupRadiusBonus: number;
  magnetStrength: number;
  
  // Defense
  damageReduction: number;
  reflectChance: number;
  
  // Field effects
  fieldRadius: number;
  fieldDps: number;
  fieldSlowPercent: number;
  fieldStunDuration: number;
  
  // Active synergies (booleans for easy checking)
  synergies: {
    // RED synergies (weapon)
    multishot: number;
    phasing: boolean;
    gatling: boolean;
    bioOrdnance: boolean;
    homing: boolean;
    heavyImpact: boolean;
    
    // BLUE synergies (field)
    thermalField: boolean;
    shieldRegen: number;
    staticCharge: boolean;
    leechField: boolean;
    amplifier: number;
    stasisField: boolean;
    
    // YELLOW synergies (mobility)
    afterburner: boolean;
    ionShield: boolean;
    turbo: boolean;
    photosynthesis: boolean;
    vacuumWake: boolean;
    rammingSpeed: boolean;
    
    // GREEN synergies (vitality)
    adrenaline: boolean;
    overShield: boolean;
    metabolism: boolean;
    symbiosis: number;
    nutrients: boolean;
    barkskin: boolean;
    
    // CYAN synergies (utility)
    unstableIsotope: boolean;
    energySiphon: boolean;
    hyperLoop: boolean;
    bioFuel: boolean;
    wideNet: number;
    corrosionField: boolean;
    
    // ORANGE synergies (defense)
    reactivePlating: boolean;
    reflector: boolean;
    kineticAbsorber: boolean;
    livingHull: boolean;
    entropy: boolean;
    fortress: number;
  };
  
  // Ring of Perfection ultimates
  ultimates: RingOfPerfectionType[];
}

// ============================================================================
// SYNERGY MATRIX
// ============================================================================

const SYNERGY_MATRIX: Record<HexColor, Record<HexColor, { type: string; description: string }>> = {
  RED: {
    RED: { type: 'MULTISHOT', description: '+1 projectile per RED neighbor' },
    BLUE: { type: 'PHASING', description: 'Bullets pierce enemies and ignore armor' },
    YELLOW: { type: 'GATLING', description: 'Fire rate increases with hold time' },
    GREEN: { type: 'BIO_ORDNANCE', description: 'Bullets grow in size/damage as they travel' },
    CYAN: { type: 'HOMING', description: 'Projectiles curve toward nearest enemy' },
    ORANGE: { type: 'HEAVY_IMPACT', description: 'Slower bullets with massive knockback' },
  },
  BLUE: {
    RED: { type: 'THERMAL_FIELD', description: 'Field deals DPS to enemies inside' },
    BLUE: { type: 'SHIELD_REGEN', description: '+1 shield regen per BLUE neighbor' },
    YELLOW: { type: 'STATIC_CHARGE', description: 'Enemies entering field are stunned 0.5s' },
    GREEN: { type: 'LEECH_FIELD', description: 'Field damage heals the player' },
    CYAN: { type: 'AMPLIFIER', description: '+25 field radius per CYAN neighbor' },
    ORANGE: { type: 'STASIS_FIELD', description: 'Enemies inside are slowed 40%' },
  },
  YELLOW: {
    RED: { type: 'AFTERBURNER', description: 'Leaves fire trail behind ship (DPS)' },
    BLUE: { type: 'ION_SHIELD', description: 'Moving adds to shield regen rate' },
    YELLOW: { type: 'TURBO', description: 'Double tap direction to dash' },
    GREEN: { type: 'PHOTOSYNTHESIS', description: 'Moving leaves healing spore trail' },
    CYAN: { type: 'VACUUM_WAKE', description: 'Moving creates suction behind ship' },
    ORANGE: { type: 'RAMMING_SPEED', description: 'At max speed, collisions damage enemies' },
  },
  GREEN: {
    RED: { type: 'ADRENALINE', description: 'Kill triggers instant regen tick' },
    BLUE: { type: 'OVER_SHIELD', description: 'HP regen fills shield when HP is full' },
    YELLOW: { type: 'METABOLISM', description: 'Regen ticks faster based on move speed' },
    GREEN: { type: 'SYMBIOSIS', description: '+1 HP per regen tick per GREEN neighbor' },
    CYAN: { type: 'NUTRIENTS', description: 'Collecting XP heals +1 HP' },
    ORANGE: { type: 'BARKSKIN', description: 'Temporary armor buff after heal tick' },
  },
  CYAN: {
    RED: { type: 'UNSTABLE_ISOTOPE', description: 'XP orbs explode on collection (AoE)' },
    BLUE: { type: 'ENERGY_SIPHON', description: 'XP orbs recharge shield on collection' },
    YELLOW: { type: 'HYPER_LOOP', description: 'XP orbs accelerate toward player faster' },
    GREEN: { type: 'BIO_FUEL', description: 'XP orbs heal HP on collection' },
    CYAN: { type: 'WIDE_NET', description: '+15 pickup range per CYAN neighbor' },
    ORANGE: { type: 'CORROSION_FIELD', description: 'Enemies in pickup range take +30% damage' },
  },
  ORANGE: {
    RED: { type: 'REACTIVE_PLATING', description: 'When hit, fires shrapnel outward' },
    BLUE: { type: 'REFLECTOR', description: 'Chance to reflect enemy projectiles' },
    YELLOW: { type: 'KINETIC_ABSORBER', description: 'Taking damage boosts speed for 2s' },
    GREEN: { type: 'LIVING_HULL', description: 'If not hit for 5s, repairs +10 HP' },
    CYAN: { type: 'ENTROPY', description: 'Melee attackers permanently lose defense' },
    ORANGE: { type: 'FORTRESS', description: 'Double damage reduction per ORANGE neighbor' },
  },
};

const RING_OF_PERFECTION: Record<HexColor, RingOfPerfectionType> = {
  RED: 'OMNI_TURRET',
  BLUE: 'AEGIS',
  YELLOW: 'CHRONOS',
  GREEN: 'YGGDRASIL',
  CYAN: 'SINGULARITY',
  ORANGE: 'JUGGERNAUT',
};

// ============================================================================
// SYNERGY CALCULATOR CLASS
// ============================================================================

export class SynergyCalculator {
  private hexGrid: HexGrid | null = null;
  private cachedStats: SynergyStats | null = null;
  private cachedShip: Record<string, HexModule> | null = null;
  private cachedSynergiesMap: Map<string, HexSynergies> = new Map();

  /**
   * Get or create HexGrid (lazy initialization to avoid circular dependency)
   */
  private getHexGrid(): HexGrid {
    if (!this.hexGrid) {
      // HexGrid is built on first use. HEX_SIZE lives in config.ts, which
      // imports the scene that imports this file, so it is not read at load.
      this.hexGrid = new HexGrid(HEX_SIZE);
    }
    return this.hexGrid;
  }

  /**
   * Calculate all synergies for the ship and return aggregated stats
   */
  calculate(ship: Record<string, HexModule>): SynergyStats {
    // Check cache
    if (this.cachedShip === ship && this.cachedStats) {
      return this.cachedStats;
    }

    // Reset cache
    this.cachedShip = ship;
    this.cachedSynergiesMap.clear();

    // Initialize stats
    const stats: SynergyStats = {
      hpRegenRate: 0,
      shieldRegenRate: 0,
      moveSpeedMultiplier: 1.0,
      hasDash: false,
      pickupRadiusBonus: 0,
      magnetStrength: SYNERGY_VALUES.BASE_MAGNET.baseStrength,
      damageReduction: 0,
      reflectChance: 0,
      fieldRadius: 0,
      fieldDps: 0,
      fieldSlowPercent: 0,
      fieldStunDuration: 0,
      synergies: {
        multishot: 0,
        phasing: false,
        gatling: false,
        bioOrdnance: false,
        homing: false,
        heavyImpact: false,
        thermalField: false,
        shieldRegen: 0,
        staticCharge: false,
        leechField: false,
        amplifier: 0,
        stasisField: false,
        afterburner: false,
        ionShield: false,
        turbo: false,
        photosynthesis: false,
        vacuumWake: false,
        rammingSpeed: false,
        adrenaline: false,
        overShield: false,
        metabolism: false,
        symbiosis: 0,
        nutrients: false,
        barkskin: false,
        unstableIsotope: false,
        energySiphon: false,
        hyperLoop: false,
        bioFuel: false,
        wideNet: 0,
        corrosionField: false,
        reactivePlating: false,
        reflector: false,
        kineticAbsorber: false,
        livingHull: false,
        entropy: false,
        fortress: 0,
      },
      ultimates: [],
    };

    // Count hexes by color for base stats
    let yellowCount = 0;
    let blueCount = 0;
    let greenCount = 0;
    let cyanCount = 0;
    let orangeCount = 0;

    Object.values(ship).forEach((hex) => {
      switch (hex.color) {
        case 'YELLOW': yellowCount++; break;
        case 'BLUE': blueCount++; break;
        case 'GREEN': greenCount++; break;
        case 'CYAN': cyanCount++; break;
        case 'ORANGE': orangeCount++; break;
      }
    });

    // Apply base stats from hex counts (using config values)
    stats.moveSpeedMultiplier += yellowCount * (BASE_HEX_STATS.YELLOW.moveSpeedPercentPerHex / 100);
    stats.pickupRadiusBonus += cyanCount * BASE_HEX_STATS.CYAN.pickupRadiusPerHex;
    stats.damageReduction += orangeCount * BASE_HEX_STATS.ORANGE.damageReductionPerHex;

    // Calculate synergies for each hex
    Object.keys(ship).forEach((key) => {
      const coord = HexGrid.fromKey(key);
      const hexSynergies = this.calculateHexSynergies(coord, ship);
      if (hexSynergies) {
        this.cachedSynergiesMap.set(key, hexSynergies);
        this.applySynergies(hexSynergies, stats);
      }
    });

    this.cachedStats = stats;
    return stats;
  }

  /**
   * Get synergies for a specific hex
   */
  getHexSynergies(key: string): HexSynergies | undefined {
    return this.cachedSynergiesMap.get(key);
  }

  /**
   * Get all cached synergies
   */
  getAllSynergies(): Map<string, HexSynergies> {
    return this.cachedSynergiesMap;
  }

  /**
   * Calculate synergies for a single hex
   */
  private calculateHexSynergies(coord: HexCoord, ship: Record<string, HexModule>): HexSynergies | null {
    const key = HexGrid.toKey(coord);
    const hex = ship[key];
    if (!hex) return null;

    const neighbors = this.getHexGrid().getNeighbors(coord);
    const synergies: SynergyEffect[] = [];

    // Count neighbors by color
    const neighborCounts: Record<HexColor, number> = {
      RED: 0, GREEN: 0, YELLOW: 0, BLUE: 0, CYAN: 0, ORANGE: 0,
    };

    neighbors.forEach((neighborCoord) => {
      const neighborKey = HexGrid.toKey(neighborCoord);
      const neighborHex = ship[neighborKey];
      if (neighborHex) {
        neighborCounts[neighborHex.color]++;
      }
    });

    // Generate synergy effects
    (Object.entries(neighborCounts) as [HexColor, number][]).forEach(([color, count]) => {
      if (count > 0) {
        const synergyDef = SYNERGY_MATRIX[hex.color][color];
        if (synergyDef) {
          synergies.push({
            type: synergyDef.type,
            value: count,
            description: synergyDef.description,
            neighborColor: color,
          });
        }
      }
    });

    // Check for Ring of Perfection (6 same-color neighbors)
    let ringOfPerfection: RingOfPerfectionType | undefined;
    if (neighbors.length === 6) {
      const allSameColor = neighbors.every((neighborCoord) => {
        const neighborKey = HexGrid.toKey(neighborCoord);
        const neighborHex = ship[neighborKey];
        return neighborHex && neighborHex.color === hex.color;
      });
      if (allSameColor) {
        ringOfPerfection = RING_OF_PERFECTION[hex.color];
      }
    }

    return { hex, coord, synergies, ringOfPerfection };
  }

  /**
   * Apply synergies from a hex to the stats
   */
  private applySynergies(hexSyn: HexSynergies, stats: SynergyStats): void {
    const hexColor = hexSyn.hex.color;

    // Add Ring of Perfection
    if (hexSyn.ringOfPerfection && !stats.ultimates.includes(hexSyn.ringOfPerfection)) {
      stats.ultimates.push(hexSyn.ringOfPerfection);
    }

    // Process each synergy
    hexSyn.synergies.forEach((syn) => {
      const count = syn.value;

      switch (syn.type) {
        // RED synergies
        case 'MULTISHOT':
          stats.synergies.multishot += count;
          break;
        case 'PHASING':
          stats.synergies.phasing = true;
          break;
        case 'GATLING':
          stats.synergies.gatling = true;
          break;
        case 'BIO_ORDNANCE':
          stats.synergies.bioOrdnance = true;
          break;
        case 'HOMING':
          stats.synergies.homing = true;
          break;
        case 'HEAVY_IMPACT':
          stats.synergies.heavyImpact = true;
          break;

        // BLUE synergies
        case 'THERMAL_FIELD':
          stats.synergies.thermalField = true;
          stats.fieldDps += SYNERGY_VALUES.THERMAL_FIELD.dpsPerNeighbor * count;
          break;
        case 'SHIELD_REGEN':
          stats.synergies.shieldRegen += count;
          stats.shieldRegenRate += SYNERGY_VALUES.SHIELD_REGEN.regenPerNeighbor * count;
          break;
        case 'STATIC_CHARGE':
          stats.synergies.staticCharge = true;
          stats.fieldStunDuration = SYNERGY_VALUES.STATIC_CHARGE.stunDuration;
          break;
        case 'LEECH_FIELD':
          stats.synergies.leechField = true;
          break;
        case 'AMPLIFIER':
          stats.synergies.amplifier += count;
          stats.fieldRadius += SYNERGY_VALUES.AMPLIFIER.radiusBonusPerNeighbor * count;
          break;
        case 'STASIS_FIELD':
          stats.synergies.stasisField = true;
          stats.fieldSlowPercent = SYNERGY_VALUES.STASIS_FIELD.slowPercent;
          break;

        // YELLOW synergies
        case 'AFTERBURNER':
          stats.synergies.afterburner = true;
          break;
        case 'ION_SHIELD':
          stats.synergies.ionShield = true;
          break;
        case 'TURBO':
          stats.synergies.turbo = true;
          stats.hasDash = true;
          stats.moveSpeedMultiplier += SYNERGY_VALUES.TURBO.speedBonusPerNeighbor * count;
          break;
        case 'PHOTOSYNTHESIS':
          stats.synergies.photosynthesis = true;
          break;
        case 'VACUUM_WAKE':
          stats.synergies.vacuumWake = true;
          break;
        case 'RAMMING_SPEED':
          stats.synergies.rammingSpeed = true;
          break;

        // GREEN synergies
        case 'ADRENALINE':
          stats.synergies.adrenaline = true;
          break;
        case 'OVER_SHIELD':
          stats.synergies.overShield = true;
          break;
        case 'METABOLISM':
          stats.synergies.metabolism = true;
          break;
        case 'SYMBIOSIS':
          stats.synergies.symbiosis += count;
          stats.hpRegenRate += SYNERGY_VALUES.SYMBIOSIS.hpRegenPerNeighbor * count;
          break;
        case 'NUTRIENTS':
          stats.synergies.nutrients = true;
          break;
        case 'BARKSKIN':
          stats.synergies.barkskin = true;
          break;

        // CYAN synergies
        case 'UNSTABLE_ISOTOPE':
          stats.synergies.unstableIsotope = true;
          break;
        case 'ENERGY_SIPHON':
          stats.synergies.energySiphon = true;
          break;
        case 'HYPER_LOOP':
          stats.synergies.hyperLoop = true;
          stats.magnetStrength = SYNERGY_VALUES.HYPER_LOOP.magnetStrength;
          break;
        case 'BIO_FUEL':
          stats.synergies.bioFuel = true;
          break;
        case 'WIDE_NET':
          stats.synergies.wideNet += count;
          stats.pickupRadiusBonus += SYNERGY_VALUES.WIDE_NET.radiusBonusPerNeighbor * count;
          break;
        case 'CORROSION_FIELD':
          stats.synergies.corrosionField = true;
          break;

        // ORANGE synergies
        case 'REACTIVE_PLATING':
          stats.synergies.reactivePlating = true;
          break;
        case 'REFLECTOR':
          stats.synergies.reflector = true;
          stats.reflectChance = Math.min(
            SYNERGY_VALUES.REFLECTOR.maxChance,
            SYNERGY_VALUES.REFLECTOR.baseChance + (SYNERGY_VALUES.REFLECTOR.chancePerNeighbor * count)
          );
          break;
        case 'KINETIC_ABSORBER':
          stats.synergies.kineticAbsorber = true;
          break;
        case 'LIVING_HULL':
          stats.synergies.livingHull = true;
          break;
        case 'ENTROPY':
          stats.synergies.entropy = true;
          break;
        case 'FORTRESS':
          stats.synergies.fortress += count;
          stats.damageReduction += SYNERGY_VALUES.FORTRESS.damageReductionPerNeighbor * count;
          break;
      }
    });
  }

  /**
   * Invalidate cache (call when ship changes)
   */
  invalidate(): void {
    this.cachedStats = null;
    this.cachedShip = null;
    this.cachedSynergiesMap.clear();
  }

  /**
   * Get shooting bonuses for a RED hex
   */
  getShootingBonuses(hexCoord: HexCoord, ship: Record<string, HexModule>): {
    projectileCount: number;
    damageMultiplier: number;
    sizeMultiplier: number;
    fireRateMultiplier: number;
    piercing: boolean;
    homing: boolean;
    heavyImpact: boolean;
    bioOrdnance: boolean;
    bioOrdnanceCount: number; // Number of GREEN neighbors for stacking
    speedMultiplier: number;
  } {
    let projectileCount = 1;
    let damageMultiplier = 1;
    let sizeMultiplier = 1;
    let fireRateMultiplier = 1;
    let piercing = false;
    let homing = false;
    let heavyImpact = false;
    let bioOrdnance = false;
    let bioOrdnanceCount = 0; // Track number of GREEN neighbors for stacking
    let speedMultiplier = 1;

    const hexSynergies = this.calculateHexSynergies(hexCoord, ship);
    if (!hexSynergies) return { projectileCount, damageMultiplier, sizeMultiplier, fireRateMultiplier, piercing, homing, heavyImpact, bioOrdnance, bioOrdnanceCount, speedMultiplier };

    hexSynergies.synergies.forEach((syn) => {
      const count = syn.value;
      switch (syn.type) {
        case 'MULTISHOT':
          projectileCount += count;
          break;
        case 'PHASING':
          piercing = true;
          break;
        case 'GATLING':
          fireRateMultiplier *= Math.pow(0.7, count);
          break;
        case 'BIO_ORDNANCE':
          bioOrdnance = true;
          sizeMultiplier = 0.5;
          damageMultiplier = 0.5;
          break;
        case 'HOMING':
          homing = true;
          speedMultiplier += 0.2 * count;
          break;
        case 'HEAVY_IMPACT':
          heavyImpact = true;
          speedMultiplier *= 0.7;
          damageMultiplier += 0.5 * count;
          break;
      }
    });

    return { projectileCount, damageMultiplier, sizeMultiplier, fireRateMultiplier, piercing, homing, heavyImpact, bioOrdnance, bioOrdnanceCount, speedMultiplier };
  }
}

// Export singleton instance
export const synergyCalculator = new SynergyCalculator();

// Export SYNERGY_MATRIX for UI display
export { SYNERGY_MATRIX, RING_OF_PERFECTION };
