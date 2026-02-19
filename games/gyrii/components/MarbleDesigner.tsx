"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth-context";
import { createClient } from "@/lib/supabase/client";
import { useGyriiStore } from "../store/gameStore";
import type { MarbleConfig, MarbleDesignId } from "../store/gameStore";
import { MARBLE_DESIGNS } from "../game/marble/MarbleMaterials";
import MarblePreview from "./MarblePreview";

const NEON_COLORS = [
  { name: "Cyan", r: 0, g: 255, b: 255 },
  { name: "Pink", r: 255, g: 0, b: 128 },
  { name: "Purple", r: 180, g: 0, b: 255 },
  { name: "Yellow", r: 255, g: 255, b: 0 },
  { name: "Green", r: 0, g: 255, b: 128 },
  { name: "Orange", r: 255, g: 128, b: 0 },
  { name: "Red", r: 255, g: 50, b: 50 },
  { name: "Blue", r: 0, g: 128, b: 255 },
  { name: "White", r: 255, g: 255, b: 255 },
];

function randomColor() {
  const c = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
  return { r: c.r, g: c.g, b: c.b };
}

export function randomMarbleConfig(): MarbleConfig {
  return {
    designId: (Math.floor(Math.random() * 4) + 1) as MarbleDesignId,
    mainColor: randomColor(),
    secondaryColor: randomColor(),
  };
}

export default function MarbleDesigner() {
  const { user } = useAuth();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { marbleConfig, setMarbleConfig, setPlayerColor } = useGyriiStore();

  const handleDesignChange = (id: MarbleDesignId) => {
    const next = { ...marbleConfig, designId: id };
    setMarbleConfig(next);
    setPlayerColor(next.mainColor);
  };

  const handleMainColorChange = (color: {
    r: number;
    g: number;
    b: number;
  }) => {
    const next = { ...marbleConfig, mainColor: color };
    setMarbleConfig(next);
    setPlayerColor(color);
  };

  const handleSecondaryColorChange = (color: {
    r: number;
    g: number;
    b: number;
  }) => {
    setMarbleConfig({ ...marbleConfig, secondaryColor: color });
  };

  const handleRandomize = () => {
    const next = randomMarbleConfig();
    setMarbleConfig(next);
    setPlayerColor(next.mainColor);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    try {
      await supabase
        .from("profiles")
        .update({ gyrii_marble_config: marbleConfig })
        .eq("id", user.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Failed to save marble:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-pink-500/30 space-y-4">
      <label className="block text-xs text-gray-400 mb-2">MARBLE DESIGN</label>

      {/* Preview - left side */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Drag to rotate</p>
        <MarblePreview config={marbleConfig} />
      </div>

      {/* Design selector */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Design</p>
        <div className="flex flex-wrap gap-2">
          {MARBLE_DESIGNS.map((d) => (
            <button
              key={d.id}
              onClick={() => handleDesignChange(d.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                marbleConfig.designId === d.id
                  ? "bg-pink-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main color */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Main Color</p>
        <div className="flex flex-wrap gap-2">
          {NEON_COLORS.map((color) => {
            const isSelected =
              marbleConfig.mainColor.r === color.r &&
              marbleConfig.mainColor.g === color.g &&
              marbleConfig.mainColor.b === color.b;
            return (
              <button
                key={color.name}
                onClick={() => handleMainColorChange(color)}
                className={`w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                  isSelected
                    ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900"
                    : ""
                }`}
                style={{
                  backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`,
                  boxShadow: `0 0 10px rgb(${color.r}, ${color.g}, ${color.b})`,
                }}
                title={color.name}
              />
            );
          })}
        </div>
      </div>

      {/* Secondary color */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Secondary Color</p>
        <div className="flex flex-wrap gap-2">
          {NEON_COLORS.map((color) => {
            const isSelected =
              marbleConfig.secondaryColor.r === color.r &&
              marbleConfig.secondaryColor.g === color.g &&
              marbleConfig.secondaryColor.b === color.b;
            return (
              <button
                key={color.name}
                onClick={() => handleSecondaryColorChange(color)}
                className={`w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                  isSelected
                    ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900"
                    : ""
                }`}
                style={{
                  backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`,
                  boxShadow: `0 0 10px rgb(${color.r}, ${color.g}, ${color.b})`,
                }}
                title={color.name}
              />
            );
          })}
        </div>
      </div>

      {/* Randomize button */}
      <button
        onClick={handleRandomize}
        className="w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 rounded transition-colors"
      >
        Randomize
      </button>

      {/* Save button for logged-in users */}
      {user && (
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2 text-sm font-medium rounded transition-colors ${
            saved
              ? "bg-green-600/30 text-green-400 border border-green-500/50"
              : "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/50"
          }`}
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save Marble"}
        </button>
      )}
    </div>
  );
}
