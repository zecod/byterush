import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Release notes as CHANGELOG.md writes them: "### Added" headings, "- " items whose text goes on
 * over indented lines, paragraphs, and `code`, **bold**, *italic* and [links](https://…) inside.
 * Built as React elements, never as HTML, so nothing in the notes can run in the app; links open
 * in the browser.
 */
export function Notes({ markdown }: { markdown: string }) {
  type Block = { kind: "heading"; text: string } | { kind: "p"; text: string } | { kind: "list"; items: { text: string; sub: boolean }[] };
  const blocks: Block[] = [];
  let open: Block | null = null;
  const close = () => {
    if (open) blocks.push(open);
    open = null;
  };

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const item = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (!line.trim()) {
      // a blank line ends a paragraph; a list goes on until something else starts
      if (open?.kind === "p") close();
    } else if (heading) {
      close();
      blocks.push({ kind: "heading", text: heading[1] });
    } else if (item) {
      if (open?.kind !== "list") {
        close();
        open = { kind: "list", items: [] };
      }
      (open as Extract<Block, { kind: "list" }>).items.push({ text: item[2], sub: item[1].length >= 2 });
    } else if (open?.kind === "list" && /^\s+/.test(raw)) {
      const items = (open as Extract<Block, { kind: "list" }>).items;
      items[items.length - 1].text += ` ${line.trim()}`;
    } else if (open?.kind === "p") {
      open.text += ` ${line.trim()}`;
    } else {
      close();
      open = { kind: "p", text: line.trim() };
    }
  }
  close();

  if (!blocks.length) return <p className="muted">no notes for this release.</p>;
  return (
    <div className="notes">
      {blocks.map((b, i) =>
        b.kind === "heading" ? (
          <h4 key={i}>{inline(b.text)}</h4>
        ) : b.kind === "p" ? (
          <p key={i}>{inline(b.text)}</p>
        ) : (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j} className={it.sub ? "sub" : undefined}>
                {inline(it.text)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(<https?:\/\/[^>\s]+>)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    const key = out.length;
    if (m[1]) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={key}>{inline(t.slice(2, -2))}</b>);
    else if (m[3]) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? [];
      out.push(link(label, href, key));
    } else if (m[4]) out.push(<i key={key}>{inline(t.slice(1, -1))}</i>);
    else out.push(link(t.slice(1, -1), t.slice(1, -1), key));
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function link(label: string, href: string, key: number): ReactNode {
  // only web addresses; anything else is shown as its text
  if (!/^https?:\/\//i.test(href)) return label;
  return (
    <a
      key={key}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openUrl(href).catch(() => {});
      }}
    >
      {label}
    </a>
  );
}
