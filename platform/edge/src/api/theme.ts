// A game's look on partii's own pages (the phone controller): colours, fonts,
// corner radius, button lips, a logo and a background. The developer uploads
// the font and image files, then sets the theme JSON naming them; anyone can
// read it (it's only looks), so the controller page can fetch it from the QR
// link's `g=` before the room is joined. Stored in R2 under themes/<game>/:
// theme.json (the theme plus its file list) and files/<sha256>.

import type { Env } from "../index";
import { files } from "../files";
import { ApiError, bad, now, ownGame, sha256hex } from "./core";
import type { Handlers } from "./index";

export const THEME_LIMITS = { fileBytes: 1024 * 1024, files: 12, totalBytes: 4 * 1024 * 1024, jsonBytes: 16 * 1024 };

/** Colour roles. Unset roles keep the page's defaults. */
export const THEME_COLORS = [
  "background",
  "surface",
  "border",
  "ink",
  "muted",
  "primary",
  "primary_lip",
  "primary_ink",
  "secondary",
  "secondary_lip",
  "secondary_ink",
  "stick",
  "stick_ring",
  "knob",
  "error",
] as const;

const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,60}\.(woff2|woff|ttf|otf|png|webp|jpg|jpeg)$/;
const FONT_FILE = /\.(woff2|woff|ttf|otf)$/;
const IMAGE_FILE = /\.(png|webp|jpg|jpeg)$/;
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** A CSS font-family list: names, spaces, commas, dashes. */
const FAMILY = /^[A-Za-z0-9 ,-]{1,100}$/;

type FileEntry = { sha256: string; size: number; type: string };
type Stored = { theme: Record<string, unknown>; files: Record<string, FileEntry>; updated_at: number };

const themeKey = (game: string) => `themes/${game}/theme.json`;
const fileKey = (game: string, sha: string) => `themes/${game}/files/${sha}`;

/** The file's real type, from its first bytes; it must match the name's extension. */
function sniff(b: Uint8Array): string | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (ascii(0, 4) === "wOF2") return "font/woff2";
  if (ascii(0, 4) === "wOFF") return "font/woff";
  if (ascii(0, 4) === "OTTO") return "font/otf";
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || ascii(0, 4) === "true") return "font/ttf";
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return null;
}

const EXT_TYPE: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

async function load(env: Env, game: string): Promise<Stored | null> {
  const o = await files(env).get(themeKey(game));
  return o ? (JSON.parse(await o.text()) as Stored) : null;
}

async function store(env: Env, game: string, s: Stored) {
  await files(env).put(themeKey(game), JSON.stringify(s), { contentType: "application/json" });
}

function num(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} is a number from ${min} to ${max}`);
  return n;
}

/** A validated theme. File references must name uploaded files of the right kind. */
export function checkTheme(t: Record<string, unknown>, have: Record<string, FileEntry>): Record<string, unknown> {
  if (JSON.stringify(t).length > THEME_LIMITS.jsonBytes) throw bad(`a theme is at most ${THEME_LIMITS.jsonBytes} bytes of JSON`);
  const known = new Set(["name", "colors", "fonts", "radius", "border", "lip", "caps", "letter_spacing", "background_image", "logo"]);
  for (const k of Object.keys(t)) if (!known.has(k)) throw bad(`unknown theme field ${k}`, `fields: ${[...known].join(", ")}`);
  const fileRef = (v: unknown, name: string, kind: RegExp) => {
    const f = String(v);
    if (!kind.test(f) || !have[f]) throw bad(`${name}: ${f} isn't an uploaded ${kind === FONT_FILE ? "font" : "image"} file`, "upload it first with `partii theme file <game> <name> --file <path>`");
    return f;
  };
  const out: Record<string, unknown> = {};
  if (t.name !== undefined) {
    const n = String(t.name).trim();
    if (n.length > 40) throw bad("name is at most 40 characters");
    out.name = n;
  }
  if (t.colors !== undefined) {
    if (typeof t.colors !== "object" || t.colors === null) throw bad("colors is an object of role: #hex");
    const colors: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.colors)) {
      if (!(THEME_COLORS as readonly string[]).includes(k)) throw bad(`unknown colour role ${k}`, `roles: ${THEME_COLORS.join(", ")}`);
      if (!COLOR.test(String(v))) throw bad(`colors.${k} is #rgb, #rrggbb or #rrggbbaa`);
      colors[k] = String(v);
    }
    out.colors = colors;
  }
  if (t.fonts !== undefined) {
    if (typeof t.fonts !== "object" || t.fonts === null) throw bad("fonts is {heading, body}");
    const fonts: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.fonts)) {
      if (k !== "heading" && k !== "body") throw bad(`unknown font ${k}`, "fonts: heading, body");
      const s = String(v);
      if (FONT_FILE.test(s)) fonts[k] = fileRef(s, `fonts.${k}`, FONT_FILE);
      else if (FAMILY.test(s)) fonts[k] = s;
      else throw bad(`fonts.${k} is an uploaded font file or a font-family list (letters, digits, spaces, commas, dashes)`);
    }
    out.fonts = fonts;
  }
  if (t.radius !== undefined) out.radius = num(t.radius, "radius", 0, 40);
  if (t.border !== undefined) out.border = num(t.border, "border", 0, 8);
  if (t.lip !== undefined) out.lip = num(t.lip, "lip", 0, 12);
  if (t.letter_spacing !== undefined) out.letter_spacing = num(t.letter_spacing, "letter_spacing", 0, 0.4);
  if (t.caps !== undefined) {
    if (typeof t.caps !== "boolean") throw bad("caps is true or false");
    out.caps = t.caps;
  }
  if (t.background_image !== undefined) out.background_image = fileRef(t.background_image, "background_image", IMAGE_FILE);
  if (t.logo !== undefined) out.logo = fileRef(t.logo, "logo", IMAGE_FILE);
  return out;
}

/** The theme with each file name replaced by its URL (cacheable forever). */
function view(origin: string, game: string, s: Stored) {
  const url = (name: string) => `${origin}/v1/games/${game}/theme/files/${s.files[name].sha256}`;
  const t = structuredClone(s.theme) as Record<string, any>;
  if (t.fonts) for (const k of Object.keys(t.fonts)) if (FONT_FILE.test(t.fonts[k])) t.fonts[k] = { file: url(t.fonts[k]) };
  if (t.background_image) t.background_image = url(t.background_image);
  if (t.logo) t.logo = url(t.logo);
  return { theme: t, files: Object.fromEntries(Object.entries(s.files).map(([n, f]) => [n, { ...f, url: url(n) }])), updated_at: s.updated_at };
}

async function gameExists(env: Env, game: string) {
  if (!(await env.DB.prepare("SELECT 1 FROM games WHERE id = ?").bind(game).first())) throw new ApiError(404, "not_found", `game ${game} not found`);
}

export const themeHandlers: Handlers = {
  async themeGet({ env, req, params }) {
    await gameExists(env, params.game);
    const s = await load(env, params.game);
    const out = s ? view(new URL(req.url).origin, params.game, s) : { theme: null, files: {}, updated_at: null };
    // A minute of caching: a changed theme reaches phones quickly.
    return new Response(JSON.stringify({ ok: true, ...out }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
  },

  async themeSet({ env, req, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const s = (await load(env, params.game)) ?? { theme: {}, files: {}, updated_at: 0 };
    const theme = checkTheme(body, s.files);
    if (dryRun) return { dry_run: true, theme };
    s.theme = theme;
    s.updated_at = now();
    await store(env, params.game, s);
    return view(new URL(req.url).origin, params.game, s);
  },

  async themeDelete({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    const s = await load(env, params.game);
    if (dryRun) return { dry_run: true, deleted: !!s };
    if (s) {
      for (const f of new Set(Object.values(s.files).map((f) => f.sha256))) await files(env).delete(fileKey(params.game, f));
      await files(env).delete(themeKey(params.game));
    }
    return { deleted: !!s };
  },

  async themeFilePut({ env, req, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    const name = params.name;
    if (!FILE_NAME.test(name)) throw bad("file names are lowercase letters, digits, . _ - ending in .woff2, .woff, .ttf, .otf, .png, .webp, .jpg or .jpeg");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) throw bad("the file is empty", "pass it with --file <path>");
    if (bytes.byteLength > THEME_LIMITS.fileBytes) throw bad(`theme files are at most ${THEME_LIMITS.fileBytes / 1024} KB`, "use woff2 for fonts and webp for images");
    const type = sniff(bytes);
    const expected = EXT_TYPE[name.split(".").pop()!];
    if (type !== expected) throw bad(`${name} doesn't look like a ${expected} file`);
    const s = (await load(env, params.game)) ?? { theme: {}, files: {}, updated_at: 0 };
    const others = Object.entries(s.files).filter(([n]) => n !== name);
    if (others.length + 1 > THEME_LIMITS.files) throw bad(`a theme has at most ${THEME_LIMITS.files} files`, "delete one with `partii theme file-delete`");
    if (others.reduce((a, [, f]) => a + f.size, 0) + bytes.byteLength > THEME_LIMITS.totalBytes) throw bad(`a theme's files are at most ${THEME_LIMITS.totalBytes / 1024 / 1024} MB together`);
    const sha = await sha256hex(bytes);
    if (dryRun) return { dry_run: true, file: { name, sha256: sha, size: bytes.byteLength, type } };
    await files(env).put(fileKey(params.game, sha), bytes, { contentType: type });
    const old = s.files[name];
    s.files[name] = { sha256: sha, size: bytes.byteLength, type };
    s.updated_at = now();
    await store(env, params.game, s);
    if (old && old.sha256 !== sha && !Object.values(s.files).some((f) => f.sha256 === old.sha256)) await files(env).delete(fileKey(params.game, old.sha256));
    return { file: { name, ...s.files[name], url: `${new URL(req.url).origin}/v1/games/${params.game}/theme/files/${sha}` } };
  },

  async themeFileDelete({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    const s = await load(env, params.game);
    const f = s?.files[params.name];
    if (!s || !f) return { deleted: false };
    const t = s.theme as Record<string, any>;
    if ([t.logo, t.background_image, t.fonts?.heading, t.fonts?.body].includes(params.name)) throw bad(`the theme uses ${params.name}`, "set a theme without it first");
    if (dryRun) return { dry_run: true, deleted: true };
    delete s.files[params.name];
    s.updated_at = now();
    await store(env, params.game, s);
    if (!Object.values(s.files).some((x) => x.sha256 === f.sha256)) await files(env).delete(fileKey(params.game, f.sha256));
    return { deleted: true };
  },

  async themeFile({ env, params }) {
    if (!/^[0-9a-f]{64}$/.test(params.sha256)) throw bad("sha256 is a hex digest");
    const s = await load(env, params.game);
    const entry = s && Object.values(s.files).find((f) => f.sha256 === params.sha256);
    const o = entry ? await files(env).get(fileKey(params.game, params.sha256)) : null;
    if (!entry || !o) throw new ApiError(404, "not_found", "no such theme file");
    return new Response(o.body, {
      headers: {
        "content-type": entry.type,
        "content-length": String(o.size),
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
