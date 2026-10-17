// Link previews (Discord, Slack, iMessage…) for store pages: the app's own
// index.html with the page's title, description and cover image as meta tags.
// Crawlers don't run the app, so without this every link shows "partii store".
// vercel.json rewrites /games/<game>, /games/<game>/updates and
// /games/<game>/updates/<version> here; anything that fails serves the plain page.
export const config = { runtime: "edge" };

const API = (process.env.VITE_PARTII_API || "https://api.partii.games").replace(/\/$/, "");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: { "user-agent": "partii-store-og" } });
  return r.ok ? r.json() : null;
}

/** title, description, image for the page, or null. */
async function meta(kind, game, version) {
  const g = await get(`/v1/store/games/${encodeURIComponent(game)}`);
  if (!g?.game) return null;
  const image = g.game.store?.cover || null;
  if (kind === "note") {
    const n = await get(`/v1/store/games/${encodeURIComponent(game)}/notes/${encodeURIComponent(version)}`);
    if (!n?.note) return null;
    return { title: n.note.title, description: n.note.excerpt || `${g.game.title} ${n.note.version}`, image, type: "article" };
  }
  if (kind === "updates") return { title: `${g.game.title} updates`, description: g.latest_note ? `Latest: ${g.latest_note.title}. ${g.latest_note.excerpt}` : `Every update to ${g.game.title}.`, image, type: "website" };
  return { title: g.game.title, description: g.game.tagline || g.game.description || "", image, type: "website" };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "game";
  const game = url.searchParams.get("game") || "";
  const version = url.searchParams.get("version") || "";
  const page = `${url.origin}/games/${encodeURIComponent(game)}${kind === "game" ? "" : "/updates"}${kind === "note" ? `/${encodeURIComponent(version)}` : ""}`;
  const shell = await fetch(`${url.origin}/index.html`);
  let html = await shell.text();
  try {
    const m = /^[a-z0-9-]+$/.test(game) ? await meta(kind, game, version) : null;
    if (m) {
      const title = clip(m.title, 90);
      const description = clip(m.description.replace(/\s+/g, " ").trim(), 200);
      const tags = [
        `<meta name="description" content="${esc(description)}" />`,
        `<meta property="og:site_name" content="partii" />`,
        `<meta property="og:type" content="${m.type}" />`,
        `<meta property="og:title" content="${esc(title)}" />`,
        `<meta property="og:description" content="${esc(description)}" />`,
        `<meta property="og:url" content="${esc(page)}" />`,
        m.image ? `<meta property="og:image" content="${esc(m.image)}" />` : "",
        `<meta name="twitter:card" content="${m.image ? "summary_large_image" : "summary"}" />`,
        `<link rel="canonical" href="${esc(page)}" />`,
      ].filter(Boolean);
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} · partii</title>`).replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
    }
  } catch {
    /* the plain page */
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } });
}
