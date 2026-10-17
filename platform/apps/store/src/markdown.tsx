// Markdown for the store's own text (policies) and developers' patch notes:
// headings, paragraphs, bullet and numbered lists (nested by indent), **bold**,
// *italic*, `code`, [links](https://…), ![images](https://…) and --- rules.
// React escapes all text, and only http(s) and site-relative URLs become links.
import type { ReactNode } from "react";

const SAFE_URL = /^(https?:\/\/|\/(?!\/))/i;

function inline(s: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!?\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let i = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    const k = `${key}.${i++}`;
    if (m[1]) {
      const lm = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t)!;
      const [, bang, label, url] = lm;
      if (!SAFE_URL.test(url)) out.push(label);
      else if (bang) out.push(<img key={k} src={url} alt={label} className="md-img" />);
      else out.push(<a key={k} href={url} rel="noopener noreferrer">{inline(label, k)}</a>);
    } else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

type Item = { text: string; kids: Item[] };
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** A list block's lines as a tree, by indent. */
function listTree(lines: string[]): { ordered: boolean; items: Item[] } {
  const root: Item = { text: "", kids: [] };
  const stack: { indent: number; item: Item }[] = [{ indent: -1, item: root }];
  let ordered = false;
  for (const [n, line] of lines.entries()) {
    const m = LIST.exec(line);
    if (!m) {
      // A continuation line joins the item above.
      const top = stack[stack.length - 1].item;
      if (top !== root) top.text += ` ${line.trim()}`;
      continue;
    }
    if (n === 0) ordered = /\d/.test(m[2]);
    const indent = m[1].replace(/\t/g, "  ").length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const item = { text: m[3], kids: [] };
    stack[stack.length - 1].item.kids.push(item);
    stack.push({ indent, item });
  }
  return { ordered, items: root.kids };
}

function List({ items, ordered, k }: { items: Item[]; ordered: boolean; k: string }) {
  const lis = items.map((it, j) => (
    <li key={j}>
      {inline(it.text, `${k}.${j}`)}
      {it.kids.length > 0 && <List items={it.kids} ordered={false} k={`${k}.${j}`} />}
    </li>
  ));
  return ordered ? <ol>{lis}</ol> : <ul>{lis}</ul>;
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const TAGS = ["h1", "h2", "h3", "h4"] as const;

export function Markdown({ text, className = "policy" }: { text: string; className?: string }) {
  const out: JSX.Element[] = [];
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  for (const [i, raw] of blocks.entries()) {
    let lines = raw.split("\n").filter((l, j, all) => l.trim() || (j > 0 && j < all.length - 1));
    // Headings first (a CHANGELOG puts its list right under "## New").
    for (let h: RegExpExecArray | null; lines.length && (h = HEADING.exec(lines[0].trim())); lines = lines.slice(1)) {
      const Tag = TAGS[h[1].length - 1];
      out.push(<Tag key={`${i}h${lines.length}`}>{inline(h[2], `${i}h`)}</Tag>);
    }
    if (!lines.length) continue;
    const block = lines.join("\n");
    const k = String(i);
    if (/^(-{3,}|\*{3,})$/.test(block.trim())) out.push(<hr key={k} />);
    else if (LIST.test(lines[0])) {
      const { ordered, items } = listTree(lines);
      out.push(<List key={k} items={items} ordered={ordered} k={k} />);
    } else out.push(<p key={k}>{inline(block.replace(/\n/g, " "), k)}</p>);
  }
  return <article className={className}>{out}</article>;
}
