// The game's look (themeGet on the edge): colours, fonts, radius, button lips,
// logo, background. Applied as CSS variables on <html>, so unset parts keep
// the page's own look. The QR link's `g=` names the game, so the theme is in
// place before the first render: from this phone's cache at once, else
// fetched (with a short timeout) before the page shows. The seat colour
// (`--tint`) stays the game's live per-player colour on top of it.

export interface Theme {
  name?: string;
  colors?: Record<string, string>;
  fonts?: { heading?: string | { file: string }; body?: string | { file: string } };
  radius?: number;
  border?: number;
  lip?: number;
  caps?: boolean;
  letter_spacing?: number;
  background_image?: string;
  logo?: string;
}

/** How long a first visit waits for the theme (and its fonts) before showing the page anyway. */
const FETCH_TIMEOUT_MS = 1500;
const FONT_TIMEOUT_MS = 1000;

const cacheKey = (edge: string, game: string) => `partii.theme.${edge}.${game}`;

function cached(edge: string, game: string): Theme | null {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(edge, game)) ?? "null");
  } catch {
    return null;
  }
}

function remember(edge: string, game: string, t: Theme | null) {
  try {
    if (t) localStorage.setItem(cacheKey(edge, game), JSON.stringify(t));
    else localStorage.removeItem(cacheKey(edge, game));
  } catch {
    /* private mode */
  }
}

let applied = "";

/** Fired on window whenever a theme is applied (the page re-reads the logo and name). */
export const THEME_EVENT = "partii-theme";

/** Set the theme's CSS variables and load its fonts; resolves when the fonts are ready (or after a timeout). */
export function applyTheme(t: Theme | null): Promise<void> {
  const key = JSON.stringify(t);
  if (key === applied) return Promise.resolve();
  applied = key;
  const root = document.documentElement;
  for (const p of [...root.style]) if (p.startsWith("--t-")) root.style.removeProperty(p);
  root.classList.toggle("themed", !!t);
  window.dispatchEvent(new Event(THEME_EVENT));
  if (!t) return Promise.resolve();
  const set = (name: string, v: string | number | undefined, unit = "") => v !== undefined && root.style.setProperty(`--t-${name}`, `${v}${unit}`);
  for (const [role, hex] of Object.entries(t.colors ?? {})) set(role.replace(/_/g, "-"), hex);
  set("radius", t.radius, "px");
  set("border-width", t.border, "px");
  set("lip", t.lip, "px");
  set("letter-spacing", t.letter_spacing, "em");
  if (t.caps !== undefined) set("caps", t.caps ? "uppercase" : "none");
  if (t.background_image) set("bg-image", `url("${encodeURI(t.background_image)}")`);
  if (t.colors?.background) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.colors.background);
  const loads: Promise<unknown>[] = [];
  for (const which of ["heading", "body"] as const) {
    const f = t.fonts?.[which];
    if (!f) continue;
    if (typeof f === "string") {
      set(`font-${which}`, f);
    } else {
      const family = `partii-${which}`;
      const face = new FontFace(family, `url("${encodeURI(f.file)}")`);
      document.fonts.add(face);
      loads.push(face.load().catch(() => {}));
      set(`font-${which}`, `${family}, system-ui, sans-serif`);
    }
  }
  return Promise.race([Promise.all(loads).then(() => {}), new Promise<void>((ok) => setTimeout(ok, FONT_TIMEOUT_MS))]);
}

export async function fetchTheme(edge: string, game: string): Promise<Theme | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${edge.replace(/\/$/, "")}/v1/games/${encodeURIComponent(game)}/theme`, { signal: ctl.signal });
    const j = await r.json();
    if (!j.ok) return null;
    remember(edge, game, j.theme);
    return j.theme;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Before the first render: the cached theme at once (then a refresh in the
 * background), else the fetched one. Never throws; a missing or slow theme
 * leaves partii's look.
 */
export async function bootTheme(edge: string, game: string | null): Promise<void> {
  if (!game) return;
  const c = cached(edge, game);
  const fresh = fetchTheme(edge, game).catch(() => undefined);
  if (c) {
    void applyTheme(c);
    fresh.then((t) => {
      if (t !== undefined) void applyTheme(t);
    });
    return;
  }
  const t = await fresh;
  if (t) await applyTheme(t);
}

/** After joining a room whose game the link didn't name (a typed code): theme it now. */
export function themeFor(edge: string, game: string) {
  const c = cached(edge, game);
  if (c) void applyTheme(c);
  fetchTheme(edge, game)
    .then((t) => applyTheme(t))
    .catch(() => {});
}

/** The applied theme (null: partii's look). */
export function currentTheme(): Theme | null {
  return applied ? (JSON.parse(applied) as Theme | null) : null;
}
