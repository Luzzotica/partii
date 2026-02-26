"use client";

import { useEffect, useRef, useState } from "react";
import { Vector3 } from "@babylonjs/core";
import { canonicalPlayerId, useGyriiStore } from "../store/gameStore";
import { useGyriiConnection } from "../hooks/useGyriiConnection";
import { maps } from "../game/maps";
import {
  GUN_MUZZLE_OFFSET_FORWARD,
  GUN_MUZZLE_OFFSET_UP,
  PLAYER_BALL_RADIUS,
} from "../game/constants";
import {
  createDashPoofEffect,
  createDeathDecal,
  createDeathExplosion,
  createExplosion,
  createHammerPopEffect,
} from "../game/effects/ParticleEffects";
import { getWeaponDisplayConfig } from "../game/weapons/weaponDisplayConstants";
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
        weaponMesh?: any;
        /** Child of weapon at muzzleOffset; use getAbsolutePosition() for shot origin. */
        muzzleNode?: any;
        lastWeapon?: string;
        /** Latest snapshot id applied from server for this player. */
        lastAppliedSnapshotId?: number;
        /** Last authoritative server snapshot we reconciled this body to. */
        lastServerPos?: { x: number; y: number; z: number };
        lastServerVel?: { x: number; y: number; z: number };
        lastServerTime?: number;
        /** Last applied impulse time (for local player hit prediction). */
        lastAppliedImpulseTime?: number;
        /** Track designId so we can recreate material when it changes. */
        lastDesignId?: number;
        namePlane?: any;
        nameTexture?: any;
        lastDisplayName?: string;
        /** CTF: flag mesh on top when carrying */
        flagMesh?: any;
      }
    >
  >(new Map());
  const flagMeshesRef = useRef<Map<string, any>>(new Map());
  const { gameState, setGameState, selectedWeapon, localPlayer } =
    useGyriiStore();
  const roundEndedBanner = useGyriiStore((s) => s.roundEndedBanner);
  const currentLobby = useGyriiStore((s) => s.currentLobby);
  const {
    updateInput,
    setShooting,
    setMarbleConfig,
    throwGrenade,
    throwMolotov,
    useSecondary,
  } = useGyriiConnection();
  const lastSentInputRef = useRef<{ inputX: number; inputZ: number }>({
    inputX: 0,
    inputZ: 0,
  });
  const aimRef = useRef<{ x: number; z: number }>({ x: 0, z: -1 });
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [bannerNowMs, setBannerNowMs] = useState(Date.now());

  useEffect(() => {
    if (!roundEndedBanner) return;
    setBannerNowMs(Date.now());
    const id = setInterval(() => setBannerNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [roundEndedBanner]);

  // Shoot input: ref updated in game loop; listener attached to canvas immediately so nothing blocks it
  const shootHandlerRef = useRef<{
    setShooting: (shooting: boolean, aimX: number, aimZ: number) => void;
    throwGrenade: (aimX: number, aimZ: number) => void;
    throwMolotov: (aimX: number, aimZ: number) => void;
    aimX: number;
    aimZ: number;
    isShooting: boolean;
    chargeStartTime: number;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    throwableRenderer: any;
    /** Compute aim from pointer event (same logic as gun); set by game loop. */
    getAimFromPointerEvent?: (e: MouseEvent | PointerEvent) => {
      aimX: number;
      aimZ: number;
    };
  }>(null as any);

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted = true;

    // Window-level listeners (same pattern as rocket-to-heaven Joystick) so nothing in arcade/game DOM can consume the click before we see it
    shootHandlerRef.current = {
      setShooting,
      throwGrenade,
      throwMolotov,
      aimX: 0,
      aimZ: -1,
      isShooting: false,
      chargeStartTime: 0,
      canvasRef,
      throwableRenderer: null as any,
      getAimFromPointerEvent: undefined,
    };

    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      const r = shootHandlerRef.current;

      // Right-click (2) or middle-click (1): throwables — same pointer event as shooting
      if (e.button === 2 || e.button === 1) {
        const store = useGyriiStore.getState();
        const me = store.localPlayer;
        if (!me || !r) return;
        if (e.button === 2) {
          if (me.grenadeCount <= 0) return;
          const nowMicros = Number(Date.now()) * 1000;
          const lastThrown = Number(me.lastGrenadeThrownAt ?? 0);
          const elapsedMicros = nowMicros - lastThrown;
          if (elapsedMicros < 1_000_000) return;
          const aim = r.getAimFromPointerEvent?.(e) ?? {
            aimX: r.aimX,
            aimZ: r.aimZ,
          };
          r.throwGrenade(aim.aimX, aim.aimZ);
        } else if (e.button === 1) {
          if (me.molotovCount <= 0) return;
          const aim = r.getAimFromPointerEvent?.(e) ?? {
            aimX: r.aimX,
            aimZ: r.aimZ,
          };
          r.throwMolotov(aim.aimX, aim.aimZ);
          if (r.throwableRenderer) {
            const pos = new Vector3(
              me.position.x,
              me.position.y ?? 0.5,
              me.position.z,
            );
            const aimVec = new Vector3(aim.aimX, 0, aim.aimZ);
            r.throwableRenderer.throw(pos, aimVec, 12, "molotov", "local");
          }
        }
        e.preventDefault();
        return;
      }

      // Left-click (0): shooting
      if (e.button !== 0) return;
      if (!r?.canvasRef?.current) return;
      const isCanvas = e.target === r.canvasRef.current;
      const container = r.canvasRef.current.parentElement;
      const insideContainer =
        container && e.target instanceof Node && container.contains(e.target);
      const isInteractive =
        e.target instanceof Element &&
        !!e.target.closest("button, a, input, select, textarea");
      const isGameArea =
        isCanvas ||
        (insideContainer && !isInteractive) ||
        (e.target instanceof Node && r.canvasRef.current.contains(e.target)) ||
        (e.button === 0 && !isInteractive);
      if (!isGameArea) return;
      const state = useGyriiStore.getState();
      const lp = state.localPlayer;
      if (
        lp?.weapon === "photonRifle" &&
        performance.now() < (state.photonRifleRechargeUntil ?? 0)
      ) {
        r.isShooting = true;
        r.setShooting(true, r.aimX, r.aimZ);
        r.chargeStartTime = 0;
        return;
      }
      r.isShooting = true;
      r.chargeStartTime = performance.now();
      r.setShooting(true, r.aimX, r.aimZ);
    };

    const handlePointerUp = (e: MouseEvent | PointerEvent) => {
      if (e.button !== 0) return;
      const r = shootHandlerRef.current;
      if (!r) return;
      if (r.isShooting) r.setShooting(false, 0, 0);
      r.isShooting = false;
      r.chargeStartTime = 0;
    };

    // Use pointer events (Babylon uses these); mousedown may not fire for canvas clicks
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);

    const initGame = async () => {
      try {
        // Import BabylonJS dynamically
        const BABYLON = await import("@babylonjs/core");

        // Import weapon systems and camera constants (weapon can override zoom)
        const { WeaponRenderer, WEAPON_CONFIGS } =
          await import("../game/weapons/WeaponRenderer");
        const { WEAPON_HANDLERS } =
          await import("../game/weapons/WeaponHandler");
        const { ThrowableRenderer } =
          await import("../game/weapons/ThrowableRenderer");
        const { loadMap } = await import("../game/maps/MapLoader");
        const { DEFAULT_CAMERA_ZOOM } = await import("../game/constants");

        if (!mounted || !canvasRef.current) return;

        // Shoot ref for game loop (updates aim; throwableRenderer set when ready)
        const shootRef = shootHandlerRef.current;

        // Create engine
        const engine = new BABYLON.Engine(canvasRef.current, true, {
          preserveDrawingBuffer: true,
          stencil: true,
        });

        // Create scene
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1);
        // Disable all Babylon mesh picking - we use Rapier for collision/raycast only
        scene.skipPointerMovePicking = true;
        scene.skipPointerDownPicking = true;
        scene.skipPointerUpPicking = true;

        setLoadingProgress(20);

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
        camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput"); // Disable arrow-key camera controls

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

        // Load map from JSON: use custom mapJson if present, else built-in
        const lobby = useGyriiStore.getState().currentLobby;
        const mapId = lobby?.mapId ?? "arena";
        const mapData =
          lobby?.isCustomMap && lobby?.mapJson
            ? (JSON.parse(
                lobby.mapJson,
              ) as import("../game/maps/MapLoader").MapData)
            : (maps[mapId] ?? maps.arena);
        loadMap(BABYLON, scene, mapData as any);

        // Client Rapier physics (same world as server: floor, boundary, interior walls)
        const {
          initRapier,
          createWorldFromMap,
          createPlayerBody,
          removePlayerBody,
          setPlayerState,
          getPlayerPosition,
          getPlayerLinvel,
          applyImpulseToPlayer,
          step,
          destroyWorld,
        } = await import("../game/physics");
        await initRapier();
        const physicsHandle = createWorldFromMap(
          mapData as import("../game/maps/MapLoader").MapData,
        );

        setLoadingProgress(80);

        // Add glow layer for player balls
        const glowLayer = new BABYLON.GlowLayer("glow", scene);
        glowLayer.intensity = 0.8;

        // Register GLB loader and load weapon templates (machine_gun -> dualMachineGun, ray_gun -> photonRifle)
        await import("@babylonjs/loaders/glTF");
        const weaponTemplates: Record<string, any> = {};
        const loadWeapon = (filename: string, key: string) =>
          new Promise<void>((resolve, reject) => {
            BABYLON.SceneLoader.ImportMesh(
              "",
              "/games/gyrii/models/",
              filename,
              scene,
              (meshes) => {
                if (meshes.length > 0) {
                  const root = meshes[0];
                  root.setEnabled(false);
                  root.name = `weaponTemplate-${key}`;
                  weaponTemplates[key] = root;
                }
                resolve();
              },
              undefined,
              (_, message) => reject(new Error(message)),
            );
          });
        try {
          await Promise.all([
            loadWeapon("machine_gun.glb", "dualMachineGun"),
            loadWeapon("ray_gun.glb", "photonRifle"),
          ]);
          // Shotgun = 2× machine_gun side by side; reuse dualMachineGun template
          if (weaponTemplates.dualMachineGun) {
            weaponTemplates.shotgun = weaponTemplates.dualMachineGun;
          }
        } catch (e) {
          console.warn("Weapon models failed to load:", e);
        }

        // Helper to get template key for a weapon type (fallback to machine gun)
        const getWeaponTemplateKey = (weapon: string) =>
          weapon === "photonRifle"
            ? "photonRifle"
            : weapon === "shotgun"
              ? "shotgun"
              : "dualMachineGun";

        // Use store's single source of truth for player id (matches store keys and player.id)
        const idForKey = canonicalPlayerId;

        // Helper to sync player meshes from store
        const playerMeshes = new Map<
          string,
          {
            playerId: string;
            rootNode: any;
            mesh: any;
            material: any;
            weaponMesh?: any;
            muzzleNode?: any;
            debugAimLine?: any;
            lastWeapon?: string;
            lastAppliedSnapshotId?: number;
            lastServerPos?: { x: number; y: number; z: number };
            lastServerVel?: { x: number; y: number; z: number };
            lastServerTime?: number;
            lastAppliedImpulseTime?: number;
            lastDesignId?: number;
            lastAimDir?: InstanceType<typeof BABYLON.Vector3>;
            namePlane?: any;
            nameTexture?: any;
            lastDisplayName?: string;
            lastTeam?: number;
            flagMesh?: any;
          }
        >();
        playerMeshesRef.current = playerMeshes;

        const { createMarbleMaterial } =
          await import("../game/marble/MarbleMaterials");

        const FLAG_TEAM_COLORS: [number, number, number][] = [
          [0.88, 0.25, 0.25],
          [0.25, 0.44, 0.94],
          [0.2, 0.75, 0.38],
          [0.88, 0.85, 0.19],
        ];
        const { TEAM_COLORS: TEAM_COLORS_255, teamColorToHex } =
          await import("../game/constants");
        const createFlagMesh = (
          scene: any,
          _parentNode: any,
          team: number,
          name: string,
        ) => {
          const group = new BABYLON.TransformNode(`flag-${name}`, scene);
          // Node is already in scene via constructor; avoid setting parent explicitly
          // (can cause "isEnabled is not a function" when parent is scene)
          group.position.y = 1.6; // 2x scale
          const [r, g, b] =
            FLAG_TEAM_COLORS[Math.min(team, FLAG_TEAM_COLORS.length - 1)] ??
            FLAG_TEAM_COLORS[0];
          const pole = BABYLON.MeshBuilder.CreateCylinder(
            `flagPole-${name}`,
            { height: 1.0, diameter: 0.16 },
            scene,
          );
          pole.parent = group;
          pole.position.y = 0.5;
          const poleMat = new BABYLON.StandardMaterial(
            `flagPoleMat-${name}`,
            scene,
          );
          poleMat.diffuseColor = new BABYLON.Color3(0.4, 0.35, 0.3);
          pole.material = poleMat;
          pole.isPickable = false;
          const cloth = BABYLON.MeshBuilder.CreatePlane(
            `flagCloth-${name}`,
            { width: 0.8, height: 0.5 },
            scene,
          );
          cloth.parent = group;
          cloth.position.set(0.4, 0.8, 0);
          const clothMat = new BABYLON.StandardMaterial(
            `flagClothMat-${name}`,
            scene,
          );
          clothMat.diffuseColor = new BABYLON.Color3(r, g, b);
          clothMat.emissiveColor = new BABYLON.Color3(
            r * 0.3,
            g * 0.3,
            b * 0.3,
          );
          cloth.material = clothMat;
          cloth.isPickable = false;
          return group;
        };

        // Track previous alive state per player so we only trigger death effects on transition
        const lastAliveByPlayerId = new Map<string, boolean>();

        // Create/delete meshes when the set of players in the store changes (avoids race conditions)
        const ensurePlayerMeshes = (allPlayers: Map<string, Player>) => {
          const lobby = useGyriiStore.getState().currentLobby;
          const isTeamMode =
            lobby?.gameMode === "teamDeathmatch" ||
            lobby?.gameMode === "captureTheFlag";
          const currentIds = new Set(allPlayers.keys());
          // Remove meshes and physics bodies for players that left
          for (const id of playerMeshes.keys()) {
            if (!currentIds.has(id)) {
              removePlayerBody(physicsHandle, id);
              const entry = playerMeshes.get(id)!;
              if (entry.flagMesh) entry.flagMesh.dispose();
              if (entry.weaponMesh) entry.weaponMesh.dispose(); // muzzleNode is child, disposed with weapon
              entry.debugAimLine?.dispose();
              if (entry.namePlane) {
                entry.namePlane.material?.dispose();
                entry.namePlane.dispose();
              }
              entry.nameTexture?.dispose();
              entry.mesh.dispose();
              entry.material.dispose();
              glowLayer.removeIncludedOnlyMesh(entry.mesh);
              entry.rootNode.dispose();
              playerMeshes.delete(id);
              lastAliveByPlayerId.delete(id);
            }
          }
          // Create meshes for new players (id is already canonical from allPlayers key)
          for (const [id, player] of allPlayers) {
            if (playerMeshes.has(id)) continue;
            const rootNode = new BABYLON.TransformNode(
              `playerRoot-${id.slice(-12)}`,
              scene,
            );
            const mesh = BABYLON.MeshBuilder.CreateSphere(
              `player-${id.slice(-12)}`,
              { diameter: 1 },
              scene,
            );
            mesh.isPickable = false;
            mesh.position.y = player.position?.y ?? PLAYER_BALL_RADIUS;
            const teamColor = isTeamMode
              ? (TEAM_COLORS_255[
                  Math.min(player.team ?? 0, TEAM_COLORS_255.length - 1)
                ] ?? TEAM_COLORS_255[0])
              : null;
            const baseConfig = player.marbleConfig ?? {
              designId: 0 as const,
              mainColor: player.color,
              secondaryColor: player.secondaryColor ?? player.color,
            };
            const config = {
              ...baseConfig,
              mainColor: teamColor ?? baseConfig.mainColor,
              secondaryColor: baseConfig.secondaryColor ?? baseConfig.mainColor,
            };
            const material = createMarbleMaterial(
              BABYLON,
              scene,
              config,
              `playerMat-${id}`,
            );
            mesh.material = material;
            glowLayer.addIncludedOnlyMesh(mesh);
            // Billboard name label above player
            const namePlane = BABYLON.MeshBuilder.CreatePlane(
              `namePlane-${id.slice(-12)}`,
              { width: 2, height: 0.5 },
              scene,
            );
            namePlane.isPickable = false;
            namePlane.parent = rootNode;
            namePlane.position.y = 1.2;
            namePlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            const nameTexture = new BABYLON.DynamicTexture(
              `nameTex-${id.slice(-12)}`,
              { width: 256, height: 64 },
              scene,
              false,
            );
            nameTexture.hasAlpha = true;
            const nameMat = new BABYLON.StandardMaterial(
              `nameMat-${id.slice(-12)}`,
              scene,
            );
            nameMat.diffuseTexture = nameTexture;
            nameMat.diffuseTexture.hasAlpha = true;
            nameMat.emissiveTexture = nameTexture;
            nameMat.emissiveTexture.hasAlpha = true;
            nameMat.useAlphaFromDiffuseTexture = true;
            nameMat.backFaceCulling = false;
            nameMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
            nameMat.alpha = 1;
            namePlane.material = nameMat;
            const displayName = player.name || "Player";
            const nameColor =
              isTeamMode && teamColor ? teamColorToHex(teamColor) : "#ffffff";
            const ctx = nameTexture.getContext() as CanvasRenderingContext2D;
            ctx.clearRect(0, 0, 256, 64);
            ctx.textAlign = "center";
            nameTexture.drawText(
              displayName,
              128,
              44,
              "bold 36px sans-serif",
              nameColor,
              "transparent",
              true,
            );
            nameTexture.update();
            // const debugAimLine = BABYLON.MeshBuilder.CreateLines(
            //   `debugAim-${id.slice(-12)}`,
            //   {
            //     points: [
            //       new BABYLON.Vector3(0, 0, 0),
            //       new BABYLON.Vector3(0, 0, 1),
            //     ],
            //   },
            //   scene,
            // );
            // debugAimLine.setParent(rootNode);
            // debugAimLine.color = new BABYLON.Color3(1, 0.2, 0.2);
            // const { weaponMesh, muzzleNode } = createWeaponMesh(
            //   id,
            //   player,
            //   rootNode,
            // );
            playerMeshes.set(id, {
              playerId: id,
              rootNode,
              mesh,
              material,
              lastWeapon: player.weapon,
              lastDesignId: config.designId,
              namePlane,
              nameTexture,
              lastDisplayName: displayName,
              lastTeam: isTeamMode ? player.team : undefined,
            });
            if (player.isAlive) {
              createPlayerBody(
                physicsHandle,
                id,
                player.position?.x ?? 0,
                player.position?.y ?? PLAYER_BALL_RADIUS,
                player.position?.z ?? 0,
                player.velocity?.x ?? 0,
                player.velocity?.y ?? 0,
                player.velocity?.z ?? 0,
              );
            }
          }
        };

        const createWeaponMesh = (
          id: string,
          player: Player,
          rootNode: any,
        ): { weaponMesh: any; muzzleNode: any } => {
          const templateKey = getWeaponTemplateKey(player.weapon);
          const baseTemplate =
            weaponTemplates.dualMachineGun ??
            weaponTemplates[templateKey] ??
            weaponTemplates.dualMachineGun;
          const displayConfig = getWeaponDisplayConfig(templateKey);
          const noWeapon = { weaponMesh: undefined, muzzleNode: undefined };
          if (!baseTemplate) return noWeapon;

          let weaponRoot: any;
          if (templateKey === "shotgun") {
            const container = new BABYLON.TransformNode(
              `weaponContainer-${id.slice(-12)}`,
              scene,
            );
            container.setParent(rootNode);
            container.position.set(
              displayConfig.offset.x,
              displayConfig.offset.y,
              displayConfig.offset.z,
            );
            if (displayConfig.rotation) {
              const r = displayConfig.rotation;
              container.rotationQuaternion =
                BABYLON.Quaternion.RotationYawPitchRoll(
                  r.y ?? 0,
                  r.x ?? 0,
                  r.z ?? 0,
                );
            }
            const s = displayConfig.scale ?? { x: 1, y: 1, z: 1 };
            for (const side of [-1, 1]) {
              const clone = baseTemplate.clone(
                `weapon-${id.slice(-12)}-${side}`,
                scene,
              )!;
              while (clone.behaviors.length) {
                clone.removeBehavior(clone.behaviors[0]);
              }
              clone.setEnabled(true);
              clone.setParent(container);
              clone.position.set(side * 0.25, 0, 0);
              if (s.x !== 1 || s.y !== 1 || s.z !== 1) {
                clone.scaling.set(s.x, s.y, s.z);
              }
            }
            weaponRoot = container;
          } else {
            const template =
              weaponTemplates[templateKey] ?? weaponTemplates.dualMachineGun;
            const clone = template.clone(`weapon-${id}`, scene)!;
            while (clone.behaviors.length) {
              clone.removeBehavior(clone.behaviors[0]);
            }
            clone.setEnabled(true);
            clone.setParent(rootNode);
            clone.position.set(
              displayConfig.offset.x,
              displayConfig.offset.y,
              displayConfig.offset.z,
            );
            if (displayConfig.rotation) {
              const r = displayConfig.rotation;
              const yaw = r.y ?? 0;
              const pitch = r.x ?? 0;
              const roll = r.z ?? 0;
              clone.rotationQuaternion =
                BABYLON.Quaternion.RotationYawPitchRoll(yaw, pitch, roll);
            }
            if (displayConfig.scale) {
              const sc = displayConfig.scale;
              if (sc.x !== 1 || sc.y !== 1 || sc.z !== 1) {
                clone.scaling.set(sc.x, sc.y, sc.z);
              }
            }
            weaponRoot = clone;
          }

          // Muzzle as child of weapon: local offset only, no math at fire time
          const muzzleNode = new BABYLON.TransformNode(
            `muzzle-${id.slice(-12)}`,
            scene,
          );
          muzzleNode.setParent(weaponRoot);
          muzzleNode.position.set(
            displayConfig.muzzleOffset.x,
            displayConfig.muzzleOffset.y,
            displayConfig.muzzleOffset.z,
          );
          // Debug sphere at muzzle so we can see where bullets come from
          const debugMuzzleSphere = BABYLON.MeshBuilder.CreateSphere(
            `muzzleDebug-${id.slice(-12)}`,
            { diameter: 0.12 },
            scene,
          );
          debugMuzzleSphere.setParent(muzzleNode);
          debugMuzzleSphere.position.set(0, 0, 0);
          const debugMat = new BABYLON.StandardMaterial(
            `muzzleDebugMat-${id.slice(-12)}`,
            scene,
          );
          debugMat.emissiveColor = new BABYLON.Color3(1, 0.3, 0);
          debugMat.disableLighting = true;
          debugMuzzleSphere.material = debugMat;
          return { weaponMesh: weaponRoot, muzzleNode };
        };

        // Create/update/delete weapon meshes from store (weapon type changes)
        const ensureWeaponMeshes = (allPlayers: Map<string, Player>) => {
          for (const [id, entry] of playerMeshes) {
            const player = allPlayers.get(id);
            if (!player) continue;
            if (entry.weaponMesh && entry.lastWeapon === player.weapon)
              continue;
            if (entry.weaponMesh) {
              entry.weaponMesh.dispose();
              entry.weaponMesh = undefined;
              entry.muzzleNode = undefined;
            }
            const created = createWeaponMesh(id, player, entry.rootNode);
            entry.weaponMesh = created.weaponMesh;
            entry.muzzleNode = created.muzzleNode;
            entry.lastWeapon = player.weapon;
          }
        };

        let lastPlayerIds = new Set<string>();
        const unsubStore = useGyriiStore.subscribe(() => {
          const { localPlayer, players } = useGyriiStore.getState();
          const allPlayers = new Map<string, Player>();
          if (localPlayer)
            allPlayers.set(idForKey(localPlayer.id), localPlayer);
          players.forEach((p, id) => allPlayers.set(idForKey(id), p));
          const currentIds = new Set(allPlayers.keys());
          const idsChanged =
            currentIds.size !== lastPlayerIds.size ||
            [...currentIds].some((id) => !lastPlayerIds.has(id));
          if (idsChanged) {
            ensurePlayerMeshes(allPlayers);
            lastPlayerIds = currentIds;
          }
          ensureWeaponMeshes(allPlayers);
        });

        // Initial sync so meshes exist before first frame
        const { localPlayer: lp, players: pl } = useGyriiStore.getState();
        const initialAll = new Map<string, Player>();
        if (lp) initialAll.set(idForKey(lp.id), lp);
        pl.forEach((p, id) => initialAll.set(idForKey(id), p));
        ensurePlayerMeshes(initialAll);
        lastPlayerIds = new Set(initialAll.keys());
        ensureWeaponMeshes(initialAll);

        // Sync loop: positions from Rapier body, ball rotation, weapon pose from aim, material (no create/delete)
        const syncPlayerMeshes = (
          localPlayer: Player | null,
          players: Map<string, Player>,
          deltaTime: number,
          localAim?: { x: number; z: number },
          localRenderPos?: { x: number; y: number; z: number },
        ) => {
          const lobby = useGyriiStore.getState().currentLobby;
          const isTeamMode =
            lobby?.gameMode === "teamDeathmatch" ||
            lobby?.gameMode === "captureTheFlag";
          const allPlayers = new Map<string, Player>();
          if (localPlayer)
            allPlayers.set(idForKey(localPlayer.id), localPlayer);
          players.forEach((p, id) => allPlayers.set(idForKey(id), p));

          for (const [rawId, player] of allPlayers) {
            const id = idForKey(rawId);
            const entry = playerMeshes.get(id);
            if (!entry || entry.playerId !== id) continue;

            const wasAlive = lastAliveByPlayerId.has(id)
              ? lastAliveByPlayerId.get(id)!
              : (player.isAlive ?? true);

            if (player.isAlive === false) {
              if (wasAlive) {
                removePlayerBody(physicsHandle, id);
                const pos = new BABYLON.Vector3(
                  player.position.x,
                  player.position.y ?? PLAYER_BALL_RADIUS,
                  player.position.z,
                );
                const deathTeamColor = isTeamMode
                  ? (TEAM_COLORS_255[
                      Math.min(player.team ?? 0, TEAM_COLORS_255.length - 1)
                    ] ?? TEAM_COLORS_255[0])
                  : null;
                const mainColor =
                  deathTeamColor ??
                  player.marbleConfig?.mainColor ??
                  player.color;
                const color3 = new BABYLON.Color3(
                  mainColor.r / 255,
                  mainColor.g / 255,
                  mainColor.b / 255,
                );
                createDeathExplosion(scene, pos, color3);
                const groundPos = new BABYLON.Vector3(
                  player.position.x,
                  0,
                  player.position.z,
                );
                // createDeathDecal(scene, groundPos, color3);
              }
              entry.mesh.setEnabled(false);
              entry.rootNode.setEnabled(false);
              lastAliveByPlayerId.set(id, false);
              continue;
            }

            // Recreate physics body on respawn (was removed on death)
            const px = player.position.x;
            const py = player.position.y ?? PLAYER_BALL_RADIUS;
            const pz = player.position.z;
            const vx = player.velocity?.x ?? 0;
            const vy = player.velocity?.y ?? 0;
            const vz = player.velocity?.z ?? 0;
            if (!getPlayerPosition(physicsHandle, id)) {
              createPlayerBody(physicsHandle, id, px, py, pz, vx, vy, vz);
            }

            entry.mesh.setEnabled(true);
            entry.mesh.isPickable = false;
            entry.rootNode.setEnabled(true);
            lastAliveByPlayerId.set(id, true);

            const heldTeam = player.heldFlagTeam;
            if (heldTeam != null) {
              if (!entry.flagMesh) {
                entry.flagMesh = createFlagMesh(
                  scene,
                  entry.rootNode,
                  heldTeam,
                  id.slice(-12),
                );
              }
            } else {
              if (entry.flagMesh) {
                entry.flagMesh.dispose();
                entry.flagMesh = undefined;
              }
            }

            const isLocal = localPlayer
              ? idForKey(localPlayer.id) === id
              : false;
            const aim =
              isLocal && localAim
                ? localAim
                : (player.aimDirection ?? { x: 0, z: -1 });

            // serverSnapshotId is now snapshot lineage from lobby_state/base_snapshot_id.
            const snapshotLineageId = player.serverSnapshotId ?? 0;
            const isNewSnapshot =
              snapshotLineageId > (entry.lastAppliedSnapshotId ?? -1);

            const prevPos = entry.lastServerPos;
            const prevVel = entry.lastServerVel;
            const serverStateChanged =
              prevPos == null ||
              prevVel == null ||
              prevPos.x !== px ||
              prevPos.y !== py ||
              prevPos.z !== pz ||
              prevVel.x !== vx ||
              prevVel.y !== vy ||
              prevVel.z !== vz;

            // Reconcile to server only when we receive a fresh authoritative snapshot.
            // Between snapshots, local body velocity stays client-predicted from input.
            if (isNewSnapshot && serverStateChanged) {
              entry.lastAppliedSnapshotId = snapshotLineageId;
              entry.lastServerPos = { x: px, y: py, z: pz };
              entry.lastServerVel = { x: vx, y: vy, z: vz };
              entry.lastServerTime = performance.now() / 1000;
              if (isLocal) {
                const currentPos = getPlayerPosition(physicsHandle, id);
                const currentVel = getPlayerLinvel(physicsHandle, id);
                if (!currentPos || !currentVel) {
                  setPlayerState(physicsHandle, id, px, py, pz, vx, vy, vz);
                } else {
                  const dx = px - currentPos.x;
                  const dy = py - currentPos.y;
                  const dz = pz - currentPos.z;
                  const posError = Math.sqrt(dx * dx + dy * dy + dz * dz);
                  const dvx = vx - currentVel.x;
                  const dvy = vy - currentVel.y;
                  const dvz = vz - currentVel.z;
                  const velError = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
                  const HARD_SNAP_POS_ERROR = 0.75;
                  const SOFT_CORRECT_POS_ERROR = 0.01;
                  const SOFT_CORRECT_VEL_ERROR = 0.1;
                  if (posError > HARD_SNAP_POS_ERROR) {
                    setPlayerState(physicsHandle, id, px, py, pz, vx, vy, vz);
                  } else if (
                    posError > SOFT_CORRECT_POS_ERROR ||
                    velError > SOFT_CORRECT_VEL_ERROR
                  ) {
                    const alpha = Math.min(1, deltaTime * 10);
                    setPlayerState(
                      physicsHandle,
                      id,
                      currentPos.x + (px - currentPos.x) * alpha,
                      currentPos.y + (py - currentPos.y) * alpha,
                      currentPos.z + (pz - currentPos.z) * alpha,
                      currentVel.x + (vx - currentVel.x) * alpha,
                      currentVel.y + (vy - currentVel.y) * alpha,
                      currentVel.z + (vz - currentVel.z) * alpha,
                    );
                  }
                }
              } else {
                setPlayerState(physicsHandle, id, px, py, pz, vx, vy, vz);
              }
            }

            // Apply server-sent impulse immediately for local player (hit prediction)
            const impulseTime = player.lastImpulseTime ?? 0;
            if (isLocal && impulseTime > (entry.lastAppliedImpulseTime ?? 0)) {
              entry.lastAppliedImpulseTime = impulseTime;
              applyImpulseToPlayer(
                physicsHandle,
                id,
                player.lastImpulseX ?? 0,
                player.lastImpulseY ?? 0,
                player.lastImpulseZ ?? 0,
              );
            }

            const mesh = entry.mesh;
            const rootNode = entry.rootNode;
            let pos =
              isLocal && localRenderPos
                ? localRenderPos
                : (getPlayerPosition(physicsHandle, id) ?? {
                    x: px,
                    y: py,
                    z: pz,
                  });

            // Extrapolate non-local players from last authoritative server state.
            if (
              !isLocal &&
              entry.lastServerPos &&
              entry.lastServerVel &&
              entry.lastServerTime != null
            ) {
              const now = performance.now() / 1000;
              const predictAheadSec = Math.min(
                0.25,
                Math.max(0, now - entry.lastServerTime),
              );
              pos = {
                x:
                  entry.lastServerPos.x +
                  entry.lastServerVel.x * predictAheadSec,
                y:
                  entry.lastServerPos.y +
                  entry.lastServerVel.y * predictAheadSec,
                z:
                  entry.lastServerPos.z +
                  entry.lastServerVel.z * predictAheadSec,
              };
            }

            mesh.position.x = pos.x;
            mesh.position.y = pos.y;
            mesh.position.z = pos.z;
            rootNode.position.x = mesh.position.x;
            rootNode.position.y = mesh.position.y;
            rootNode.position.z = mesh.position.z;

            const vel = getPlayerLinvel(physicsHandle, id) ?? {
              x: vx,
              y: vy,
              z: vz,
            };

            const ax = aim.x || 0;
            const az = aim.z || -1;
            const len = Math.sqrt(ax * ax + az * az) || 1;
            const targetAimDir = new BABYLON.Vector3(-az / len, 0, ax / len);
            // Lerp rotation toward target (2-3 steps to converge, ~0.45 blend)
            const ROTATION_LERP = 0.45;
            const prevAim = entry.lastAimDir ?? targetAimDir.clone();
            const lerpedAim = BABYLON.Vector3.Lerp(
              prevAim,
              targetAimDir,
              ROTATION_LERP,
            ).normalize();
            entry.lastAimDir = lerpedAim.clone();
            rootNode.setDirection(lerpedAim);

            const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
            if (speed > 0.01 && deltaTime > 0) {
              const deltaAngle = (speed * deltaTime) / PLAYER_BALL_RADIUS;
              const axis = new BABYLON.Vector3(-vel.z, 0, vel.x).normalize();
              entry.mesh.rotate(axis, -deltaAngle, BABYLON.Space.WORLD);
            }

            const syncTeamColor = isTeamMode
              ? (TEAM_COLORS_255[
                  Math.min(player.team ?? 0, TEAM_COLORS_255.length - 1)
                ] ?? TEAM_COLORS_255[0])
              : null;
            const baseConfig = player.marbleConfig ?? {
              designId: 0 as const,
              mainColor: player.color,
              secondaryColor: player.secondaryColor ?? player.color,
            };
            const config = {
              ...baseConfig,
              mainColor: syncTeamColor ?? baseConfig.mainColor,
              secondaryColor: baseConfig.secondaryColor ?? baseConfig.mainColor,
            };
            // Recreate material when designId changes (shader is baked at creation)
            if (config.designId !== (entry.lastDesignId ?? -1)) {
              const oldMat = entry.material;
              const newMat = createMarbleMaterial(
                BABYLON,
                scene,
                config,
                `playerMat-${id}`,
              );
              entry.mesh.material = newMat;
              oldMat.dispose();
              entry.material = newMat;
              entry.lastDesignId = config.designId;
            }
            // Update name label when player name or team/mode changes
            const displayName = player.name || "Player";
            const nameColor =
              isTeamMode && syncTeamColor
                ? teamColorToHex(syncTeamColor)
                : "#ffffff";
            const teamChanged =
              isTeamMode && (entry.lastTeam ?? -1) !== (player.team ?? -1);
            const switchedFromTeamMode = !isTeamMode && entry.lastTeam != null;
            if (
              entry.nameTexture &&
              (displayName !== (entry.lastDisplayName ?? "") ||
                teamChanged ||
                switchedFromTeamMode)
            ) {
              entry.lastDisplayName = displayName;
              entry.lastTeam = isTeamMode ? player.team : undefined;
              const ctx = entry.nameTexture.getContext();
              ctx.clearRect(0, 0, 256, 64);
              ctx.textAlign = "center";
              entry.nameTexture.drawText(
                displayName,
                128,
                44,
                "bold 36px sans-serif",
                nameColor,
                "transparent",
                true,
              );
              entry.nameTexture.update();
            }
            const inBeam = useGyriiStore
              .getState()
              .playersInBeamHighlight.has(id);
            if (entry.material.setColor3) {
              const main = config.mainColor;
              const sec = config.secondaryColor;
              const baseMain = new BABYLON.Color3(
                main.r / 255,
                main.g / 255,
                main.b / 255,
              );
              const baseSec = new BABYLON.Color3(
                sec.r / 255,
                sec.g / 255,
                sec.b / 255,
              );
              entry.material.setColor3?.(
                "mainColor",
                inBeam
                  ? BABYLON.Color3.Lerp(
                      baseMain,
                      new BABYLON.Color3(0.4, 0.9, 1),
                      0.7,
                    )
                  : baseMain,
              );
              entry.material.setColor3?.(
                "secondaryColor",
                inBeam
                  ? BABYLON.Color3.Lerp(
                      baseSec,
                      new BABYLON.Color3(0.5, 1, 1),
                      0.7,
                    )
                  : baseSec,
              );
            } else if (entry.material.albedoColor) {
              const r = config.mainColor.r / 255;
              const g = config.mainColor.g / 255;
              const b = config.mainColor.b / 255;
              entry.material.albedoColor = new BABYLON.Color3(r, g, b);
              entry.material.emissiveColor = inBeam
                ? new BABYLON.Color3(0.4, 0.9, 1.0)
                : new BABYLON.Color3(r * 0.5, g * 0.5, b * 0.5);
            }
          }
        };

        setLoadingProgress(100);

        // Initialize weapon renderers
        const weaponRenderer = new WeaponRenderer(scene, physicsHandle);
        const throwableRenderer = new ThrowableRenderer(
          scene,
          physicsHandle,
          glowLayer,
        );
        shootRef.throwableRenderer = throwableRenderer;
        weaponRendererRef.current = weaponRenderer;
        throwableRendererRef.current = throwableRenderer;

        // Store reference
        gameSceneRef.current = { engine, scene, camera, glowLayer };

        // Handle resize
        const handleResize = () => {
          engine.resize();
        };
        window.addEventListener("resize", handleResize);

        // Input handling: send only on press/release (instant, no polling)
        const inputMap: { [key: string]: boolean } = {};
        const sendInputIfChanged = () => {
          if (useGyriiStore.getState().gameState === "paused") return;
          if (!useGyriiStore.getState().localPlayer) return;
          let inputX = 0,
            inputZ = 0;
          if (inputMap["w"] || inputMap["arrowup"]) inputZ = 1;
          if (inputMap["s"] || inputMap["arrowdown"]) inputZ = -1;
          if (inputMap["a"] || inputMap["arrowleft"]) inputX = -1;
          if (inputMap["d"] || inputMap["arrowright"]) inputX = 1;
          const last = lastSentInputRef.current;
          if (last.inputX !== inputX || last.inputZ !== inputZ) {
            last.inputX = inputX;
            last.inputZ = inputZ;
            const aim = aimRef.current;
            updateInput(inputX, inputZ, aim.x, aim.z);
          }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
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
          if (e.key === " ") {
            e.preventDefault();
            const lp = useGyriiStore.getState().localPlayer;
            if (lp?.isAlive && useSecondary) {
              useSecondary();
            }
            return;
          }
          inputMap[e.key.toLowerCase()] = true;
          sendInputIfChanged();
        };
        const handleKeyUp = (e: KeyboardEvent) => {
          if (e.key === " ") e.preventDefault();
          inputMap[e.key.toLowerCase()] = false;
          sendInputIfChanged();
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // Mouse position tracking for aiming
        let aimDirection = new BABYLON.Vector3(0, 0, -1);
        let mouseScreenPos = { x: 0, y: 0 };
        const MIN_AIM_LENGTH_SQ = 0.0001;

        const handlePointerMove = (e: MouseEvent | PointerEvent) => {
          const canvas = canvasRef.current;
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            mouseScreenPos.x = e.clientX - rect.left;
            mouseScreenPos.y = e.clientY - rect.top;
          } else {
            mouseScreenPos.x = e.clientX;
            mouseScreenPos.y = e.clientY;
          }
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

        // Shooting state (server-authoritative: shot feedback when lastShotAt changes)
        let lastShotAtRef = 0;
        const lastShotAtPerPlayer = new Map<string, number>();

        // Game loop (physics + input with catch-up in render loop; setInterval starves when main thread is busy)
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

          // Use local player position for aim/camera/render from one post-step sample per frame.
          const mapCenter = new BABYLON.Vector3(0, 0.5, 0);
          const localId = localPlayer ? idForKey(localPlayer.id) : null;

          // Resolve mouse world target: ray-plane intersection at y=0 (no mesh picking).
          let mouseWorldPos: Vector3 | null = null;
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
            }
          }

          // Fixed-step physics: input applied once per physics tick (matches server)
          let inputX = 0,
            inputZ = 0;
          if (inputMap["w"] || inputMap["arrowup"]) inputZ = 1;
          if (inputMap["s"] || inputMap["arrowdown"]) inputZ = -1;
          if (inputMap["a"] || inputMap["arrowleft"]) inputX = -1;
          if (inputMap["d"] || inputMap["arrowright"]) inputX = 1;
          const projectileCollisions = step(physicsHandle, deltaTime, {
            localPlayerId: localPlayer ? idForKey(localPlayer.id) : undefined,
            input: localPlayer
              ? {
                  playerId: idForKey(localPlayer.id),
                  inputX,
                  inputZ,
                }
              : undefined,
          });

          const localPhysicsPos = localId
            ? getPlayerPosition(physicsHandle, localId)
            : null;
          const myPos =
            localPlayer && localPhysicsPos
              ? new BABYLON.Vector3(
                  localPhysicsPos.x,
                  localPhysicsPos.y,
                  localPhysicsPos.z,
                )
              : localPlayer
                ? new BABYLON.Vector3(
                    localPlayer.position.x,
                    localPlayer.position.y ?? 0.5,
                    localPlayer.position.z,
                  )
                : mapCenter;
          const localRenderPos = localPhysicsPos
            ? {
                x: localPhysicsPos.x,
                y: localPhysicsPos.y,
                z: localPhysicsPos.z,
              }
            : undefined;

          if (mouseWorldPos && localPlayer) {
            const dx = mouseWorldPos.x - myPos.x;
            const dz = mouseWorldPos.z - myPos.z;
            const lenSq = dx * dx + dz * dz;
            if (lenSq > MIN_AIM_LENGTH_SQ) {
              const invLen = 1 / Math.sqrt(lenSq);
              aimDirection.x = dx * invLen;
              aimDirection.y = 0;
              aimDirection.z = dz * invLen;
              aimRef.current = { x: aimDirection.x, z: aimDirection.z };
            }
          }

          const localAim =
            localPlayer && aimDirection
              ? { x: aimDirection.x, z: aimDirection.z }
              : undefined;
          shootRef.aimX = aimDirection.x;
          shootRef.aimZ = aimDirection.z;

          // Send aim updates to server while shooting so direction tracks live mouse
          if (shootRef.isShooting) {
            shootRef.setShooting(true, aimDirection.x, aimDirection.z);
          }

          // Register aim-from-pointer so grenade/molotov use same aim as gun (computed at click position)
          shootRef.getAimFromPointerEvent = (e: MouseEvent | PointerEvent) => {
            const canvas = shootRef.canvasRef?.current;
            if (!canvas || !localPlayer) {
              return { aimX: aimDirection.x, aimZ: aimDirection.z };
            }
            const rect = canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;
            let mouseWorldPos: Vector3 | null = null;
            const pickRay = scene.createPickingRay(
              canvasX,
              canvasY,
              BABYLON.Matrix.Identity(),
              camera,
            );
            if (pickRay.direction.y !== 0) {
              const t = -pickRay.origin.y / pickRay.direction.y;
              if (t > 0) {
                mouseWorldPos = pickRay.origin.add(pickRay.direction.scale(t));
                mouseWorldPos.y = 0;
              }
            }
            if (mouseWorldPos && myPos) {
              const dx = mouseWorldPos.x - myPos.x;
              const dz = mouseWorldPos.z - myPos.z;
              const lenSq = dx * dx + dz * dz;
              if (lenSq > MIN_AIM_LENGTH_SQ) {
                const invLen = 1 / Math.sqrt(lenSq);
                return {
                  aimX: dx * invLen,
                  aimZ: dz * invLen,
                };
              }
            }
            return { aimX: aimDirection.x, aimZ: aimDirection.z };
          };

          // Sync player meshes from physics (positions/velocities from Rapier)
          syncPlayerMeshes(
            localPlayer,
            players,
            deltaTime,
            localAim,
            localRenderPos,
          );

          // Sync CTF flag meshes (at-base and dropped)
          const { flags: flagsMap, currentLobby: lobby } =
            useGyriiStore.getState();
          const lobbyId = lobby?.id ?? "";
          const isCTF = lobby?.gameMode === "captureTheFlag";
          const flagMeshes = flagMeshesRef.current;
          if (isCTF && lobbyId) {
            // Use server flags if present; fallback to map flagLocations when store is empty
            const flagsToRender: Array<{
              key: string;
              team: number;
              position: { x: number; y: number; z: number };
            }> = [];
            const serverFlags = Array.from(flagsMap.entries()).filter(
              ([key, f]) =>
                key.startsWith(`${lobbyId}:`) && f.state !== "carried",
            );
            const numTeams = lobby?.numTeams ?? 2;
            // Maps can use 0-indexed (0,1,2,3) or 1-indexed (1,2,3,4 from MapEditor)
            const sources =
              serverFlags.length > 0
                ? serverFlags.map(([, f]) => f.team)
                : (mapData?.flagLocations ?? []).map((fl) => fl.team);
            const usesZeroIndexed = sources.some((t) => t === 0);
            const teamInRange = (team: number) =>
              usesZeroIndexed
                ? team >= 0 && team < numTeams
                : team >= 1 && team <= numTeams;
            if (serverFlags.length > 0) {
              for (const [key, f] of serverFlags) {
                if (teamInRange(f.team))
                  flagsToRender.push({
                    key,
                    team: f.team,
                    position: f.position,
                  });
              }
            } else if (mapData?.flagLocations?.length) {
              for (const fl of mapData.flagLocations) {
                if (teamInRange(fl.team))
                  flagsToRender.push({
                    key: `${lobbyId}:${fl.team}`,
                    team: fl.team,
                    position: { x: fl.x, y: 0.5, z: fl.y },
                  });
              }
            }
            const seen = new Set<string>();
            for (const { key, team, position } of flagsToRender) {
              seen.add(key);
              let flagMesh = flagMeshes.get(key);
              if (!flagMesh) {
                flagMesh = createFlagMesh(scene, scene, team, key);
                flagMeshes.set(key, flagMesh);
              }
              flagMesh.position.set(position.x, position.y, position.z);
              flagMesh.setEnabled(true);
            }
            for (const key of flagMeshes.keys()) {
              if (!seen.has(key) && key.startsWith(`${lobbyId}:`)) {
                const m = flagMeshes.get(key);
                if (m) m.dispose();
                flagMeshes.delete(key);
              }
            }
          } else {
            for (const m of flagMeshes.values()) m.dispose();
            flagMeshes.clear();
          }

          // 1) Drain pending shot events from server (Projectile table inserts) — bullets/rockets
          const pendingShots = useGyriiStore.getState().takePendingShotEvents();
          for (const ev of pendingShots) {
            weaponRenderer.fireProjectile(
              ev.position,
              ev.velocity,
              ev.projectileType,
              ev.playerId,
            );
          }

          // 1b) Drain pending grenade events from server — spawn/remove/update visuals
          const {
            inserts: grenadeInserts,
            deletes: grenadeDeletes,
            updates: grenadeUpdates,
          } = useGyriiStore.getState().takePendingGrenadeEvents();
          for (const ev of grenadeInserts) {
            throwableRenderer.throwFromServer(
              ev.position,
              ev.velocity,
              ev.rigidBodyId,
              ev.ownerId,
              ev.ownerColor,
            );
          }
          for (const ev of grenadeUpdates) {
            throwableRenderer.updateServerGrenadePosition(
              ev.rigidBodyId,
              ev.position,
              ev.velocity,
            );
          }
          for (const ev of grenadeDeletes) {
            const pos = throwableRenderer.removeServerGrenade(ev.rigidBodyId);
            if (pos) {
              createExplosion(
                scene,
                new BABYLON.Vector3(pos.x, pos.y, pos.z),
                2.5,
              );
            }
          }

          // 1c) Drain pending secondary effect events — spawn hammer/dash visuals
          const secondaryEvents = store.takePendingSecondaryEffectEvents();
          for (const ev of secondaryEvents) {
            const pos = new BABYLON.Vector3(
              ev.position.x,
              ev.position.y,
              ev.position.z,
            );
            const player = players.get(ev.playerId);
            const playerColor = player?.color
              ? new BABYLON.Color3(
                  player.color.r / 255,
                  player.color.g / 255,
                  player.color.b / 255,
                )
              : undefined;
            if (ev.secondaryType === "popupHammers") {
              createHammerPopEffect(scene, pos, playerColor);
            } else if (ev.secondaryType === "dash") {
              createDashPoofEffect(scene, pos, ev.direction);
            }
          }

          // 2) lastShotAt feedback only for hitscan (photon rifle); projectiles use pending events
          const HITSCAN_WEAPONS = new Set<string>([
            "photonRifle",
            "flamethrower",
          ]);
          if (localPlayer && aimDirection.lengthSquared() > 0.01) {
            const serverLastShotAt = localPlayer.lastShotAt ?? 0;
            if (serverLastShotAt !== lastShotAtRef) {
              if (
                serverLastShotAt > 0 &&
                HITSCAN_WEAPONS.has(localPlayer.weapon)
              ) {
                const handler = WEAPON_HANDLERS[localPlayer.weapon];
                const localId = idForKey(localPlayer.id);
                const entry = playerMeshesRef.current.get(localId);
                const muzzlePos = entry?.muzzleNode
                  ? entry.muzzleNode.getAbsolutePosition().clone()
                  : (() => {
                      const p = myPos.add(
                        aimDirection.scale(GUN_MUZZLE_OFFSET_FORWARD),
                      );
                      p.y += GUN_MUZZLE_OFFSET_UP;
                      return p;
                    })();
                handler.onShotFired(weaponRenderer, muzzlePos, aimDirection);
                if (localPlayer.weapon === "photonRifle") {
                  const rechargeMs =
                    WEAPON_CONFIGS.photonRifle?.rechargeAfterFireMs ?? 2000;
                  useGyriiStore
                    .getState()
                    .setPhotonRifleRechargeUntil(
                      performance.now() + rechargeMs,
                    );
                }
              }
              lastShotAtRef = serverLastShotAt;
            }
          }

          // Other players' shot feedback: when their lastShotAt changes, spawn bullet visual
          for (const [id, player] of players) {
            if (localPlayer?.id === id) continue;
            const serverLastShotAt = player.lastShotAt ?? 0;
            const prev = lastShotAtPerPlayer.get(id) ?? 0;
            if (serverLastShotAt !== prev && serverLastShotAt > 0) {
              lastShotAtPerPlayer.set(id, serverLastShotAt);
              if (!HITSCAN_WEAPONS.has(player.weapon)) continue;
              const handler = WEAPON_HANDLERS[player.weapon];
              const entry = playerMeshesRef.current.get(idForKey(id));
              const aim = player.aimDirection
                ? new BABYLON.Vector3(
                    player.aimDirection.x,
                    0,
                    player.aimDirection.z,
                  ).normalize()
                : new BABYLON.Vector3(0, 0, -1);
              const muzzlePos = entry?.muzzleNode
                ? entry.muzzleNode.getAbsolutePosition().clone()
                : (() => {
                    const pos = new BABYLON.Vector3(
                      player.position.x,
                      player.position.y ?? PLAYER_BALL_RADIUS,
                      player.position.z,
                    );
                    const p = pos.add(aim.scale(GUN_MUZZLE_OFFSET_FORWARD));
                    p.y += GUN_MUZZLE_OFFSET_UP;
                    return p;
                  })();
              handler.onShotFired(weaponRenderer, muzzlePos, aim);
            }
          }
          // Clean up refs for players that left
          for (const id of lastShotAtPerPlayer.keys()) {
            if (!players.has(id)) lastShotAtPerPlayer.delete(id);
          }

          // Charge visual: update store for HUD when holding with a charge weapon
          if (shootRef.isShooting && localPlayer) {
            const handler = WEAPON_HANDLERS[localPlayer.weapon];
            const progress =
              handler.getChargeProgress?.({
                chargeStartTime: shootRef.chargeStartTime,
              }) ?? 0;
            useGyriiStore.getState().setWeaponChargeProgress(progress);
          } else {
            useGyriiStore.getState().setWeaponChargeProgress(0);
          }

          weaponRenderer.update(deltaTime, projectileCollisions);
          weaponRenderer.updateBeams(
            Array.from(useGyriiStore.getState().photonBeams.values()),
          );
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
          // When spectating (no localPlayer), use max zoom for overview of map
          const zoomConfig =
            WEAPON_CONFIGS[store.selectedWeapon].cameraZoom ??
            DEFAULT_CAMERA_ZOOM;
          if (localPlayer && mouseWorldPos) {
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
          } else if (!localPlayer) {
            // Spectator: wider view of map center
            camera.radius = BABYLON.Scalar.Lerp(
              camera.radius,
              zoomConfig.radiusMax,
              Math.min(1, deltaTime * 8),
            );
          }
        });

        engine.runRenderLoop(() => scene.render());

        setIsLoading(false);
        setGameState("playing");

        // Cleanup function
        return () => {
          mounted = false;
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
          window.removeEventListener("pointerdown", handlePointerDown, true);
          window.removeEventListener("pointerup", handlePointerUp, true);
          unsubStore();
          for (const [, entry] of playerMeshes) {
            if (entry.weaponMesh) entry.weaponMesh.dispose();
            entry.debugAimLine?.dispose();
            glowLayer.removeIncludedOnlyMesh(entry.mesh);
            entry.mesh.dispose();
            entry.material.dispose();
            entry.rootNode.dispose();
          }
          playerMeshes.clear();
          destroyWorld(physicsHandle);
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
  }, [setGameState, updateInput, setShooting]);

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
      {!isLoading && roundEndedBanner && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45">
          <div className="rounded-xl border border-yellow-400/60 bg-black/75 px-8 py-6 text-center shadow-2xl">
            <div className="text-xs tracking-widest text-yellow-300 mb-2">
              ROUND ENDED
            </div>
            <div className="text-4xl font-extrabold text-white mb-3">
              {roundEndedBanner.winnerPlayerName
                ? `${roundEndedBanner.winnerPlayerName} wins!`
                : roundEndedBanner.winnerTeam != null
                  ? `Team ${roundEndedBanner.winnerTeam + 1} wins!`
                  : "Winner decided"}
            </div>
            <div className="text-sm text-cyan-300 mb-1">
              Next map: {roundEndedBanner.nextMapId}
            </div>
            <div className="text-sm text-gray-300">
              New round starts in{" "}
              {Math.max(
                0,
                Math.ceil(
                  (roundEndedBanner.shownAtMs +
                    roundEndedBanner.countdownMs -
                    bannerNowMs) /
                    1000,
                ),
              )}
              s
            </div>
            {currentLobby?.gameState === "ended" && (
              <div className="mt-2 text-xs text-gray-400">
                Select your loadout when respawn screen appears.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
