/**
 * marasAiMarkdown.ts — safe Markdown parsing for MARAS AI replies
 * (PR #130, presentation only).
 *
 * The model answers in Markdown; the drawer used to render it raw, so
 * mobile users saw literal "##" and "**" markers. This module parses the
 * COMMON subset the model actually produces (headings, bullet/numbered
 * lists, bold, inline code, http(s) links, paragraphs) into a TYPED node
 * tree that the React renderer maps to elements directly.
 *
 * Safety by construction: no HTML string is ever built and nothing is
 * ever injected into the DOM as markup — literal HTML in a reply (e.g.
 * "<script>") stays plain text, and only http/https link targets are
 * accepted (anything else — javascript:, data:, relative — renders as
 * plain text). Everything here is pure and unit-tested.
 */

export type MarasAiInlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MarasAiBlockNode =
  | { kind: "heading"; level: 1 | 2 | 3; children: MarasAiInlineNode[] }
  | { kind: "paragraph"; children: MarasAiInlineNode[] }
  | { kind: "list"; ordered: boolean; items: MarasAiInlineNode[][] };

const SAFE_LINK = /^https?:\/\//i;

/** Inline pass: bold (**text**), inline code (`text`), and [text](https://…) links. */
export function parseMarasAiInline(text: string): MarasAiInlineNode[] {
  const nodes: MarasAiInlineNode[] = [];
  // One combined scanner so constructs can't nest into broken output.
  const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) nodes.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) {
      nodes.push({ kind: "bold", text: m[2] });
    } else if (m[4] !== undefined) {
      nodes.push({ kind: "code", text: m[4] });
    } else if (m[6] !== undefined && m[7] !== undefined) {
      if (SAFE_LINK.test(m[7])) {
        nodes.push({ kind: "link", text: m[6], href: m[7] });
      } else {
        // Unsafe target: keep the visible text only, as plain text.
        nodes.push({ kind: "text", text: m[6] });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ kind: "text", text: text.slice(last) });
  return nodes.length ? nodes : [{ kind: "text", text }];
}

/** Block pass: headings, bullet/numbered lists, paragraphs (blank-line separated). */
export function parseMarasAiMarkdown(raw: string): MarasAiBlockNode[] {
  const blocks: MarasAiBlockNode[] = [];
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", children: parseMarasAiInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseMarasAiInline) });
    }
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseMarasAiInline(heading[2]),
      });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}
