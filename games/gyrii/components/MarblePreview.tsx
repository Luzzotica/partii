"use client";

import { useEffect, useRef } from "react";
import * as BABYLON from "@babylonjs/core";
import { createMarbleMaterial } from "../game/marble/MarbleMaterials";
import type { MarbleConfig } from "../store/gameStore";

export default function MarblePreview({ config }: { config: MarbleConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    engine: BABYLON.Engine;
    scene: BABYLON.Scene;
    sphere: BABYLON.Mesh;
    material: BABYLON.Material;
  } | null>(null);
  const mountedRef = useRef(true);
  const disposeRef = useRef<(() => void) | null>(null);

  // Init: create scene once on mount
  useEffect(() => {
    if (!canvasRef.current) return;
    mountedRef.current = true;

    const canvas = canvasRef.current;
    const engine = new BABYLON.Engine(canvas, true, { stencil: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);

    const light = new BABYLON.HemisphericLight(
      "light",
      new BABYLON.Vector3(0, 1, 0),
      scene,
    );
    light.intensity = 0.8;

    const dirLight = new BABYLON.DirectionalLight(
      "dir",
      new BABYLON.Vector3(-1, -2, -1),
      scene,
    );
    dirLight.intensity = 0.6;

    const sphere = BABYLON.MeshBuilder.CreateSphere(
      "marble",
      { diameter: 1.2, segments: 24 },
      scene,
    );

    const material = createMarbleMaterial(
      BABYLON as any,
      scene,
      config,
      "marbleMat",
    );
    sphere.material = material;

    const camera = new BABYLON.ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      Math.PI / 3,
      2.5,
      BABYLON.Vector3.Zero(),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    // Remove scroll-to-zoom (ball doesn't need it)
    camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");

    const rotateSpeed = 0.2;
    let lastTime = performance.now();

    const render = () => {
      if (!mountedRef.current || !scene || !sphere) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      sphere.rotation.y += rotateSpeed * dt;
      scene.render();
    };

    engine.runRenderLoop(render);

    sceneRef.current = { engine, scene, sphere, material };

    const dispose = () => {
      sceneRef.current = null;
      scene.dispose();
      engine.dispose();
    };
    disposeRef.current = dispose;

    return () => {
      mountedRef.current = false;
      const fn = disposeRef.current;
      if (fn) {
        disposeRef.current = null;
        fn();
      }
      sceneRef.current = null;
    };
  }, []);

  // Update material when config changes (no scene rebuild)
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    const { scene, sphere } = ctx;
    const oldMat = ctx.material;
    const newMaterial = createMarbleMaterial(
      BABYLON as any,
      scene,
      config,
      `marbleMat-${config.designId}`,
    );
    sphere.material = newMaterial;
    oldMat?.dispose?.();
    ctx.material = newMaterial;
  }, [
    config.designId,
    config.mainColor.r,
    config.mainColor.g,
    config.mainColor.b,
    config.secondaryColor.r,
    config.secondaryColor.g,
    config.secondaryColor.b,
  ]);

  return (
    <div className="w-full aspect-square max-w-[240px] rounded-lg overflow-hidden bg-black/50 border border-cyan-500/30">
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
