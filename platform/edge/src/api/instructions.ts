// How to install and play: markdown per game and platform, shown on the store
// right after a download starts (and behind "How to install" later). A game
// sets its own from its pipeline; any platform it hasn't set uses partii's
// defaults below ({{title}} is the game's title, {{file}} the download's name).

import type { Env } from "../index";
import { ApiError, bad, now, ownGame } from "./core";
import type { Handlers } from "./index";

export const INSTRUCTION_PLATFORMS = ["windows", "macos", "linux", "android"] as const;
type Platform = (typeof INSTRUCTION_PLATFORMS)[number];
const MAX_BYTES = 16 * 1024;

export const DEFAULT_INSTRUCTIONS: Record<Platform, string> = {
  windows: `1. Open your **Downloads** folder, right-click **{{file}}** and choose **Extract All…**, then **Extract**. Don't run the game from inside the zip.
2. Open the extracted folder (and the folder inside it, if there is one) and double-click **{{title}}** (the \`.exe\`).
3. "Windows protected your PC"? Click **More info**, then **Run anyway**. Windows shows this for new games that aren't code-signed yet.
4. "VCRUNTIME140.dll was not found"? Install the [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe), then start the game again.`,
  macos: `1. Open your **Downloads** folder and double-click **{{file}}** to unzip it.
2. Drag **{{title}}** into your **Applications** folder.
3. The first time, **right-click** {{title}}, choose **Open**, then **Open** again. macOS asks once for apps that aren't notarized yet.
4. Still won't open? Go to **System Settings › Privacy & Security**, scroll down and click **Open Anyway**.`,
  linux: `1. Extract **{{file}}**: right-click it and choose **Extract Here**, or run \`tar -xzf {{file}}\` (for a \`.zip\`: \`unzip {{file}}\`).
2. Open the extracted folder and run the game (double-click it, or \`./<game>\` in a terminal).
3. Won't start? Make it executable: right-click › **Properties** › **Allow executing as program**, or \`chmod +x\` the game file.

On a **Steam Deck**, do this in Desktop Mode. To play from Gaming Mode, add the game file to Steam with **Add a Non-Steam Game**.`,
  android: `1. Open **{{file}}** from your notifications or your **Downloads**.
2. If Android asks, allow your browser to **install unknown apps**, then go back and tap **Install**.
3. Open **{{title}}** from your home screen or app drawer.`,
};

function platform(v: unknown): Platform {
  const p = String(v ?? "");
  if (!(INSTRUCTION_PLATFORMS as readonly string[]).includes(p)) throw bad(`platform is one of ${INSTRUCTION_PLATFORMS.join(", ")}`);
  return p as Platform;
}

/** Every platform's instructions for a game: its own, or partii's defaults (still with {{placeholders}}). */
export async function instructionsFor(env: Env, game: string): Promise<Record<Platform, { markdown: string; custom: boolean }>> {
  const r = await env.DB.prepare("SELECT platform, markdown FROM game_instructions WHERE game_id = ?").bind(game).all<{ platform: Platform; markdown: string }>();
  const own = new Map(r.results.map((x) => [x.platform, x.markdown]));
  return Object.fromEntries(INSTRUCTION_PLATFORMS.map((p) => [p, own.has(p) ? { markdown: own.get(p)!, custom: true } : { markdown: DEFAULT_INSTRUCTIONS[p], custom: false }])) as Record<
    Platform,
    { markdown: string; custom: boolean }
  >;
}

export const instructionHandlers: Handlers = {
  async instructionsSet({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const p = platform(body.platform);
    if (body.reset === true) {
      if (dryRun) return { dry_run: true, platform: p, custom: false };
      await env.DB.prepare("DELETE FROM game_instructions WHERE game_id = ? AND platform = ?").bind(g.id, p).run();
      return { platform: p, custom: false, markdown: DEFAULT_INSTRUCTIONS[p] };
    }
    const markdown = String(body.markdown ?? "").replace(/\r\n/g, "\n").trim();
    if (!markdown) throw bad("markdown is the instructions (markdown text); reset: true goes back to partii's defaults", "partii instructions set <game> --platform windows --markdown @windows.md");
    if (new TextEncoder().encode(markdown).byteLength > MAX_BYTES) throw bad(`markdown is at most ${MAX_BYTES / 1024} KB`);
    if (dryRun) return { dry_run: true, platform: p, custom: true, markdown };
    await env.DB.prepare("INSERT INTO game_instructions (game_id, platform, markdown, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (game_id, platform) DO UPDATE SET markdown = excluded.markdown, updated_at = excluded.updated_at")
      .bind(g.id, p, markdown, now())
      .run();
    return { platform: p, custom: true, markdown };
  },

  async instructionsList({ env, params }) {
    const g = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(params.game).first<{ id: string }>();
    if (!g) throw new ApiError(404, "not_found", `no game ${params.game}`);
    return { instructions: await instructionsFor(env, g.id), placeholders: { "{{title}}": "the game's title", "{{file}}": "the downloaded file's name" } };
  },
};
