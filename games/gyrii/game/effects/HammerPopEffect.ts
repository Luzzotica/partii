/**
 * Hammers pop effect: 8 hammer meshes extend radially from the player, then retract.
 * Uses a preloaded hammer template (GLB model).
 */

import * as BABYLON from "@babylonjs/core";

const NUM_HAMMERS = 8;
const EXTEND_DISTANCE = 1.2;
const HAMMER_SCALE = 0.4;
const EXTEND_DURATION_MS = 150;
const HOLD_DURATION_MS = 50;
const RETRACT_DURATION_MS = 150;
const TOTAL_DURATION_MS =
  EXTEND_DURATION_MS + HOLD_DURATION_MS + RETRACT_DURATION_MS;

/**
 * Clone a mesh hierarchy (root + children) for use as an instance.
 * Returns the root node and all descendant meshes.
 */
function cloneMeshHierarchy(
  source: BABYLON.Node,
  name: string,
  scene: BABYLON.Scene,
): BABYLON.TransformNode {
  const clone = source.clone(name, null)!;
  clone.setEnabled(true);
  return clone as BABYLON.TransformNode;
}

/**
 * Apply player color to all meshes in a hierarchy.
 * Clones materials to avoid affecting the template.
 */
function applyColorToHierarchy(
  node: BABYLON.Node,
  color: BABYLON.Color3,
): void {
  if (node instanceof BABYLON.Mesh && node.material) {
    try {
      const orig = node.material;
      const mat = orig.clone(
        `hammer-mat-${node.name}-${Math.random().toString(36).slice(2)}`,
      ) as BABYLON.PBRMaterial | BABYLON.StandardMaterial;
      node.material = mat;
      if ("albedoColor" in mat) {
        (mat as BABYLON.PBRMaterial).albedoColor = color;
      }
      if ("diffuseColor" in mat) {
        (mat as BABYLON.StandardMaterial).diffuseColor = color;
      }
      if ("emissiveColor" in mat) {
        mat.emissiveColor = color;
      }
      if ("emissiveIntensity" in mat) {
        mat.emissiveIntensity = 0.5;
      }
    } catch {
      // Material clone failed, skip
    }
  }
  const childMeshes =
    node instanceof BABYLON.TransformNode ? node.getChildMeshes() : [];
  childMeshes.forEach((child) => applyColorToHierarchy(child, color));
}

export interface HammerPopEffectState {
  disposables: BABYLON.Node[];
  unregister: () => void;
}

/**
 * Spawn 8 hammers that pop out radially from the player and retract.
 * Uses the provided hammer template (root node from ImportMesh).
 * Disposes itself when the animation completes.
 */
export function createHammerPopMeshEffect(
  scene: BABYLON.Scene,
  position: BABYLON.Vector3,
  hammerTemplate: BABYLON.TransformNode,
  playerColor?: BABYLON.Color3,
): HammerPopEffectState {
  const color = playerColor ?? new BABYLON.Color3(0.8, 0.6, 0.2);
  const disposables: BABYLON.Node[] = [];

  // Directions: 8 hammers in a horizontal ring, slightly angled up
  const directions: BABYLON.Vector3[] = [];
  for (let i = 0; i < NUM_HAMMERS; i++) {
    const angle = (i / NUM_HAMMERS) * Math.PI * 2;
    const dir = new BABYLON.Vector3(
      Math.cos(angle),
      0.3,
      Math.sin(angle),
    ).normalize();
    directions.push(dir);
  }

  const hammers: { node: BABYLON.TransformNode; direction: BABYLON.Vector3 }[] =
    [];
  for (let i = 0; i < NUM_HAMMERS; i++) {
    const clone = cloneMeshHierarchy(
      hammerTemplate,
      `hammerPop-${Date.now()}-${i}`,
      scene,
    );
    applyColorToHierarchy(clone, color);
    clone.position = position.clone();
    clone.scaling = new BABYLON.Vector3(
      HAMMER_SCALE,
      HAMMER_SCALE,
      HAMMER_SCALE,
    );
    clone.setEnabled(true);
    disposables.push(clone);

    // Orient hammer to point outward
    const dir = directions[i];
    clone.lookAt(clone.position.add(dir));
    hammers.push({ node: clone, direction: dir });
  }

  const startTime = Date.now();

  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= TOTAL_DURATION_MS) {
      disposables.forEach((d) => d.dispose());
      scene.onBeforeRenderObservable.remove(observer);
      return;
    }

    let t: number;
    if (elapsed < EXTEND_DURATION_MS) {
      t = elapsed / EXTEND_DURATION_MS;
      t = t * t;
    } else if (elapsed < EXTEND_DURATION_MS + HOLD_DURATION_MS) {
      t = 1;
    } else {
      const retractElapsed = elapsed - EXTEND_DURATION_MS - HOLD_DURATION_MS;
      t = 1 - retractElapsed / RETRACT_DURATION_MS;
      t = 1 - (1 - t) * (1 - t);
    }

    const dist = t * EXTEND_DISTANCE;
    hammers.forEach(({ node, direction }) => {
      node.position.copyFrom(position.add(direction.clone().scale(dist)));
    });
  });

  return {
    disposables,
    unregister: () => scene.onBeforeRenderObservable.remove(observer),
  };
}
