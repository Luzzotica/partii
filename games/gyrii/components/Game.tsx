"use client";

import { useEffect, useRef, useState } from "react";
import type { Vector3 } from "@babylonjs/core";
import { useGyriiStore } from "../store/gameStore";
import { useSpacetimeDB } from "../hooks/useSpacetimeDB";
import { maps } from "../game/maps";
import HUD from "./HUD";
import PauseMenu from "./PauseMenu";
import type { Player } from "../store/gameStore";

// Types for weapon and throwable renderers
type WeaponRendererType =
  typeof import("../game/weapons/WeaponRenderer").WeaponRenderer;
type ThrowableRendererType =
  typeof import("../game/weapons/ThrowableRenderer").ThrowableRenderer;

export default function GyriiGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameSceneRef = useRef<any>(null);
  const weaponRendererRef = useRef<InstanceType<WeaponRendererType> | null>(
    null,
  );
  const throwableRendererRef =
    useRef<InstanceType<ThrowableRendererType> | null>(null);
  const playerMeshesRef = useRef<
    Map<
      string,
      {
        mesh: any;
        material: any;
        lastPos?: { x: number; z: number };
        targetPos?: { x: number; z: number };
      }
    >
  >(new Map());
  const { gameState, setGameState, selectedWeapon, localPlayer } =
    useGyriiStore();
  const { updateInput, setMarbleConfig } = useSpacetimeDB();
  const updateInputIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Sync marble config to server when we enter the game
  const marbleConfigSyncedRef = useRef(false);
  const marbleConfig = useGyriiStore((s) => s.marbleConfig);
  useEffect(() => {
    if (!localPlayer) {
      marbleConfigSyncedRef.current = false;
      return;
    }
    if (marbleConfigSyncedRef.current) return;
    marbleConfigSyncedRef.current = true;
    setMarbleConfig(marbleConfig);
  }, [localPlayer, marbleConfig, setMarbleConfig]);

  useEffect(() => {
    if (!canvasRef.current) return;

    let mounted = true;

    const initGame = async () => {
      try {
        // Import BabylonJS dynamically
        const BABYLON = await import("@babylonjs/core");

        // Import Havok physics
        const HavokPhysics = await import("@babylonjs/havok");

        // Import weapon systems and camera constants (weapon can override zoom)
        const { WeaponRenderer, WEAPON_CONFIGS } =
          await import("../game/weapons/WeaponRenderer");
        const { ThrowableRenderer } =
          await import("../game/weapons/ThrowableRenderer");
        const { loadMap } = await import("../game/maps/MapLoader");
        const { DEFAULT_CAMERA_ZOOM } = await import("../game/constants");

        if (!mounted || !canvasRef.current) return;

        // Create engine
        const engine = new BABYLON.Engine(canvasRef.current, true, {
          preserveDrawingBuffer: true,
          stencil: true,
        });

        // Create scene
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1);

        // Initialize Havok physics
        setLoadingProgress(20);
        const havokInstance = await HavokPhysics.default();
        const havokPlugin = new BABYLON.HavokPlugin(true, havokInstance);
        scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), havokPlugin);

        setLoadingProgress(40);

        // Create top-down camera; zoom from constants (overridable per weapon in render loop)
        const camera = new BABYLON.ArcRotateCamera(
          "camera",
          -Math.PI / 2, // alpha - rotation around Y axis
          Math.PI / 6, // beta - angle from top (30 degrees from vertical)
          DEFAULT_CAMERA_ZOOM.radiusMin,
          BABYLON.Vector3.Zero(),
          scene,
        );
        camera.lowerRadiusLimit = DEFAULT_CAMERA_ZOOM.radiusMin;
        camera.upperRadiusLimit = DEFAULT_CAMERA_ZOOM.radiusMax;
        camera.lowerBetaLimit = Math.PI / 8;
        camera.upperBetaLimit = Math.PI / 3;
        camera.attachControl(canvasRef.current, false);
        camera.panningSensibility = 0; // Disable panning
        camera.inputs.removeByType("ArcRotateCameraPointersInput"); // Disable orbit on drag

        // Initialize camera target for smooth following
        let cameraTarget = BABYLON.Vector3.Zero();

        setLoadingProgress(60);

        // Create lighting
        const ambientLight = new BABYLON.HemisphericLight(
          "ambient",
          new BABYLON.Vector3(0, 1, 0),
          scene,
        );
        ambientLight.intensity = 0.4;
        ambientLight.groundColor = new BABYLON.Color3(0.1, 0.1, 0.2);

        const mainLight = new BABYLON.DirectionalLight(
          "main",
          new BABYLON.Vector3(-1, -2, -1),
          scene,
        );
        mainLight.intensity = 0.8;

        // Load map from JSON based on lobby's mapId
        const mapId = useGyriiStore.getState().currentLobby?.mapId ?? "arena";
        const mapData = maps[mapId] ?? maps.arena;
        loadMap(BABYLON, scene, mapData as any);

        setLoadingProgress(80);

        // Add glow layer for player balls
        const glowLayer = new BABYLON.GlowLayer("glow", scene);
        glowLayer.intensity = 0.8;

        // Helper to sync player meshes from store
        const playerMeshes = new Map<
          string,
          {
            mesh: any;
            material: any;
            lastPos?: { x: number; z: number };
            targetPos?: { x: number; z: number };
          }
        >();
        playerMeshesRef.current = playerMeshes;

        const { createMarbleMaterial, createSolidMarbleMaterial } =
          await import("../game/marble/MarbleMaterials");

        const syncPlayerMeshes = (
          localPlayer: Player | null,
          players: Map<string, Player>,
          deltaTime: number,
        ) => {
          const allPlayers = new Map<string, Player>();
          if (localPlayer) allPlayers.set(localPlayer.id, localPlayer);
          players.forEach((p, id) => allPlayers.set(id, p));

          // Remove meshes for players that left
          for (const id of playerMeshes.keys()) {
            if (!allPlayers.has(id)) {
              const entry = playerMeshes.get(id)!;
              entry.mesh.dispose();
              entry.material.dispose();
              glowLayer.removeIncludedOnlyMesh(entry.mesh);
              playerMeshes.delete(id);
            }
          }

          const radius = 0.5;

          // Create or update meshes
          for (const [id, player] of allPlayers) {
            let entry = playerMeshes.get(id);
            if (!entry) {
              const mesh = BABYLON.MeshBuilder.CreateSphere(
                `player-${id}`,
                { diameter: 1 },
                scene,
              );
              mesh.position.y = 0.5;
              const config = player.marbleConfig ?? {
                designId: 0 as const,
                mainColor: player.color,
                secondaryColor: player.color,
              };
              let material: any;
              try {
                material = createMarbleMaterial(
                  BABYLON,
                  scene,
                  config,
                  `playerMat-${id}`,
                );
              } catch {
                material = createSolidMarbleMaterial(
                  BABYLON,
                  scene,
                  config,
                  `playerMat-${id}`,
                );
              }
              mesh.material = material;
              glowLayer.addIncludedOnlyMesh(mesh);
              entry = { mesh, material };
              playerMeshes.set(id, entry);
            }
            const px = player.position.x;
            const pz = player.position.z;
            entry.targetPos = { x: px, z: pz };

            // Lerp toward target position for smooth movement (fixes choppy server updates)
            const LERP_SPEED = 12;
            const t = Math.min(1, deltaTime * LERP_SPEED);
            const mesh = entry.mesh;
            mesh.position.x = mesh.position.x + (px - mesh.position.x) * t;
            mesh.position.y = 0.5;
            mesh.position.z = mesh.position.z + (pz - mesh.position.z) * t;

            // Rolling: rotation from velocity (ω = v / r)
            const lastPos = entry.lastPos;
            entry.lastPos = { x: mesh.position.x, z: mesh.position.z };
            if (deltaTime > 0 && lastPos !== undefined) {
              const vx = (px - lastPos.x) / deltaTime;
              const vz = (pz - lastPos.z) / deltaTime;
              const speed = Math.sqrt(vx * vx + vz * vz);
              if (speed > 0.01) {
                const deltaAngle = ((speed * deltaTime) / radius) * 0.25; // 1/2 spin rate
                const axis = new BABYLON.Vector3(-vz, 0, vx).normalize();
                entry.mesh.rotate(axis, -deltaAngle, BABYLON.Space.WORLD);
              }
            }

            // Update material if marbleConfig changed (e.g. after server sync)
            const config = player.marbleConfig ?? {
              designId: 0 as const,
              mainColor: player.color,
              secondaryColor: player.color,
            };
            if (entry.material.setColor3) {
              const main = config.mainColor;
              const sec = config.secondaryColor;
              entry.material.setColor3?.(
                "mainColor",
                new BABYLON.Color3(main.r / 255, main.g / 255, main.b / 255),
              );
              entry.material.setColor3?.(
                "secondaryColor",
                new BABYLON.Color3(sec.r / 255, sec.g / 255, sec.b / 255),
              );
            } else if (entry.material.albedoColor) {
              const r = config.mainColor.r / 255;
              const g = config.mainColor.g / 255;
              const b = config.mainColor.b / 255;
              entry.material.albedoColor = new BABYLON.Color3(r, g, b);
              entry.material.emissiveColor = new BABYLON.Color3(
                r * 0.5,
                g * 0.5,
                b * 0.5,
              );
            }
          }
        };

        setLoadingProgress(100);

        // Initialize weapon renderers
        const weaponRenderer = new WeaponRenderer(scene);
        const throwableRenderer = new ThrowableRenderer(scene);
        weaponRendererRef.current = weaponRenderer;
        throwableRendererRef.current = throwableRenderer;

        // Store reference
        gameSceneRef.current = { engine, scene, camera, glowLayer };

        // Handle resize
        const handleResize = () => {
          engine.resize();
        };
        window.addEventListener("resize", handleResize);

        // Input handling
        const inputMap: { [key: string]: boolean } = {};
        const handleKeyDown = (e: KeyboardEvent) => {
          // Handle Escape key for pause
          if (e.key === "Escape") {
            e.preventDefault();
            const currentState = useGyriiStore.getState().gameState;
            if (currentState === "playing") {
              useGyriiStore.getState().setGameState("paused");
            } else if (currentState === "paused") {
              useGyriiStore.getState().setGameState("playing");
            }
            return;
          }
          inputMap[e.key.toLowerCase()] = true;
        };
        const handleKeyUp = (e: KeyboardEvent) => {
          inputMap[e.key.toLowerCase()] = false;
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // Mouse position tracking for aiming
        let aimDirection = new BABYLON.Vector3(0, 0, -1);
        let mouseScreenPos = { x: 0, y: 0 };

        const handlePointerMove = (e: MouseEvent | PointerEvent) => {
          mouseScreenPos.x = e.clientX;
          mouseScreenPos.y = e.clientY;
          useGyriiStore.getState().setMousePosition(e.clientX, e.clientY);
        };
        // Capture phase on document so we get move events during click-drag (before Babylon or others capture)
        document.addEventListener(
          "mousemove",
          handlePointerMove as (e: MouseEvent) => void,
          true,
        );
        document.addEventListener(
          "pointermove",
          handlePointerMove as (e: PointerEvent) => void,
          true,
        );

        // Shooting state
        let isShooting = false;
        let lastShotTime = 0;

        // Mouse button handlers
        const handleMouseDown = (e: MouseEvent) => {
          if (e.button === 0) {
            isShooting = true;
          } else if (e.button === 2) {
            const store = useGyriiStore.getState();
            const me = store.localPlayer;
            if (me) {
              const pos = new BABYLON.Vector3(
                me.position.x,
                0.5,
                me.position.z,
              );
              throwableRenderer.throw(
                pos,
                aimDirection,
                15,
                "grenade",
                "local",
              );
            }
          } else if (e.button === 1) {
            const store = useGyriiStore.getState();
            const me = store.localPlayer;
            if (me) {
              const pos = new BABYLON.Vector3(
                me.position.x,
                0.5,
                me.position.z,
              );
              throwableRenderer.throw(
                pos,
                aimDirection,
                12,
                "molotov",
                "local",
              );
            }
          }
        };

        const handleMouseUp = (e: MouseEvent) => {
          if (e.button === 0) {
            isShooting = false;
          }
        };

        canvasRef.current.addEventListener("mousedown", handleMouseDown);
        canvasRef.current.addEventListener("mouseup", handleMouseUp);

        // Send input to server at ~20 Hz
        updateInputIntervalRef.current = setInterval(() => {
          if (useGyriiStore.getState().gameState === "paused") return;
          let inputX = 0,
            inputZ = 0;
          if (inputMap["w"] || inputMap["arrowup"]) inputZ = 1;
          if (inputMap["s"] || inputMap["arrowdown"]) inputZ = -1;
          if (inputMap["a"] || inputMap["arrowleft"]) inputX = -1;
          if (inputMap["d"] || inputMap["arrowright"]) inputX = 1;
          const store = useGyriiStore.getState();
          if (store.localPlayer) {
            updateInput(
              inputX,
              inputZ,
              aimDirection.x,
              aimDirection.z,
              isShooting,
            );
          }
        }, 50);

        // Game loop
        let lastFrameTime = performance.now();

        scene.onBeforeRenderObservable.add(() => {
          const currentState = useGyriiStore.getState().gameState;
          if (currentState === "paused") return;

          const currentTime = performance.now();
          const deltaTime = (currentTime - lastFrameTime) / 1000;
          lastFrameTime = currentTime;

          const store = useGyriiStore.getState();
          const localPlayer = store.localPlayer;
          const players = store.players;

          // Sync player meshes from store
          syncPlayerMeshes(localPlayer, players, deltaTime);

          // Use local player position for aim/camera (from server)
          const myPos = localPlayer
            ? new BABYLON.Vector3(
                localPlayer.position.x,
                0.5,
                localPlayer.position.z,
              )
            : BABYLON.Vector3.Zero();

          // Calculate aim direction from mouse
          let mouseWorldPos: Vector3 | null = null;
          const pickInfo = scene.pick(mouseScreenPos.x, mouseScreenPos.y);
          if (pickInfo?.pickedPoint) {
            mouseWorldPos = pickInfo.pickedPoint.clone();
            mouseWorldPos.y = 0;
            aimDirection = mouseWorldPos.subtract(myPos).normalize();
            aimDirection.y = 0;
            if (aimDirection.lengthSquared() > 0.01) aimDirection.normalize();
          } else {
            const ray = scene.createPickingRay(
              mouseScreenPos.x,
              mouseScreenPos.y,
              BABYLON.Matrix.Identity(),
              camera,
            );
            if (ray.direction.y !== 0) {
              const t = -ray.origin.y / ray.direction.y;
              if (t > 0) {
                mouseWorldPos = ray.origin.add(ray.direction.scale(t));
                mouseWorldPos.y = 0;
                aimDirection = mouseWorldPos.subtract(myPos).normalize();
                aimDirection.y = 0;
                if (aimDirection.lengthSquared() > 0.01)
                  aimDirection.normalize();
              }
            }
          }

          // Handle shooting (visual only for now)
          if (isShooting && localPlayer) {
            const currentWeaponConfig = WEAPON_CONFIGS[store.selectedWeapon];
            const timeSinceLastShot = currentTime - lastShotTime;
            const fireInterval = 1000 / currentWeaponConfig.fireRate;
            if (timeSinceLastShot >= fireInterval) {
              const muzzlePos = myPos.add(aimDirection.scale(0.7));
              muzzlePos.y += 0.3;
              weaponRenderer.fireHitscan(
                muzzlePos,
                aimDirection,
                currentWeaponConfig,
                () => {},
              );
              lastShotTime = currentTime;
            }
          }

          weaponRenderer.update(deltaTime);
          throwableRenderer.update(deltaTime);

          // Camera target at .25 between player and mouse; aimer visual at mouse (HUD)
          let targetPosition: Vector3;
          if (mouseWorldPos && localPlayer) {
            targetPosition = BABYLON.Vector3.Lerp(myPos, mouseWorldPos, 0.25);
          } else {
            targetPosition = myPos.clone();
          }
          const cameraLerpSpeed = Math.min(1.0, deltaTime * 10);
          cameraTarget = BABYLON.Vector3.Lerp(
            cameraTarget,
            targetPosition,
            cameraLerpSpeed,
          );
          camera.target.copyFrom(cameraTarget);

          // Zoom camera by mouse distance from player; config from constants, overridable per weapon
          const zoomConfig =
            WEAPON_CONFIGS[store.selectedWeapon].cameraZoom ??
            DEFAULT_CAMERA_ZOOM;
          if (mouseWorldPos && localPlayer) {
            const dx = mouseWorldPos.x - myPos.x;
            const dz = mouseWorldPos.z - myPos.z;
            const mouseDist = Math.sqrt(dx * dx + dz * dz);
            const t = Math.min(mouseDist / zoomConfig.mouseZoomMaxDist, 1);
            const targetRadius =
              zoomConfig.radiusMin +
              t * (zoomConfig.radiusMax - zoomConfig.radiusMin);
            camera.radius = BABYLON.Scalar.Lerp(
              camera.radius,
              targetRadius,
              Math.min(1, deltaTime * 8),
            );
          }
        });

        // Start render loop
        engine.runRenderLoop(() => {
          scene.render();
        });

        setIsLoading(false);
        setGameState("playing");

        // Cleanup function
        return () => {
          mounted = false;
          if (updateInputIntervalRef.current) {
            clearInterval(updateInputIntervalRef.current);
            updateInputIntervalRef.current = null;
          }
          window.removeEventListener("resize", handleResize);
          window.removeEventListener("keydown", handleKeyDown);
          window.removeEventListener("keyup", handleKeyUp);
          document.removeEventListener(
            "mousemove",
            handlePointerMove as (e: MouseEvent) => void,
            true,
          );
          document.removeEventListener(
            "pointermove",
            handlePointerMove as (e: PointerEvent) => void,
            true,
          );
          canvasRef.current?.removeEventListener("mousedown", handleMouseDown);
          canvasRef.current?.removeEventListener("mouseup", handleMouseUp);
          for (const [, { mesh, material }] of playerMeshes) {
            mesh.dispose();
            material.dispose();
          }
          playerMeshes.clear();
          weaponRenderer.dispose();
          throwableRenderer.dispose();
          scene.dispose();
          engine.dispose();
        };
      } catch (error) {
        console.error("Failed to initialize game:", error);
        setIsLoading(false);
      }
    };

    const cleanup = initGame();

    return () => {
      mounted = false;
      cleanup?.then((fn) => fn?.());
    };
  }, [setGameState, updateInput]);

  return (
    <div className="relative w-full h-full">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500 mb-8">
              GYRII
            </h1>
            <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-pink-500 transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-gray-400">
              Loading assets... {loadingProgress}%
            </p>
          </div>
        </div>
      )}

      {/* Game canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none"
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* UI Overlays - Game only mounts when user has joined a lobby */}
      {!isLoading && gameState === "playing" && <HUD />}
      {!isLoading && gameState === "paused" && <PauseMenu />}
    </div>
  );
}
