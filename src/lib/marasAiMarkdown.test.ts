import { describe, it, expect } from "vitest";
import { parseMarasAiMarkdown, parseMarasAiInline } from "./marasAiMarkdown";

describe("parseMarasAiMarkdown — markers become structure, never visible text", () => {
  it("headings render as headings (## never appears as text)", () => {
    const blocks = parseMarasAiMarkdown("## Delayed Shipments\nTwo shipments need attention.");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(blocks[0].kind === "heading" && blocks[0].children[0]).toMatchObject({ kind: "text", text: "Delayed Shipments" });
    expect(JSON.stringify(blocks)).not.toContain("##");
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("bold markers become bold nodes (** never appears as text)", () => {
    const nodes = parseMarasAiInline("Shipment **MAR-2026-1001** is stuck.");
    expect(nodes).toEqual([
      { kind: "text", text: "Shipment " },
      { kind: "bold", text: "MAR-2026-1001" },
      { kind: "text", text: " is stuck." },
    ]);
  });

  it("bullet and numbered lists become list blocks with per-item inline parsing", () => {
    const blocks = parseMarasAiMarkdown("- **MAR-1**: delayed\n- MAR-2: ok\n\n1. check driver\n2. call customer");
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[0].kind === "list" && blocks[0].items).toHaveLength(2);
    expect(blocks[0].kind === "list" && blocks[0].items[0][0]).toMatchObject({ kind: "bold", text: "MAR-1" });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });

  it("plain text passes through as a single paragraph (backward compatibility)", () => {
    const blocks = parseMarasAiMarkdown("Just a normal sentence with no markdown.");
    expect(blocks).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "Just a normal sentence with no markdown." }] }]);
  });

  it("consecutive non-blank lines join into one paragraph; blank lines split", () => {
    const blocks = parseMarasAiMarkdown("line one\nline two\n\nsecond para");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind === "paragraph" && blocks[0].children[0]).toMatchObject({ text: "line one line two" });
  });
});

describe("safety — no HTML, no unsafe links, ever", () => {
  it("literal HTML stays literal text (no node kind can carry markup)", () => {
    const blocks = parseMarasAiMarkdown('<script>alert(1)</script> and <img src=x onerror=y>');
    expect(blocks[0].kind).toBe("paragraph");
    const texts = blocks[0].kind === "paragraph" ? blocks[0].children.map((c) => c.kind) : [];
    expect(new Set(texts)).toEqual(new Set(["text"]));
  });

  it("only http/https links become links; javascript:/data: targets degrade to plain text", () => {
    expect(parseMarasAiInline("[ok](https://etir.app)")).toEqual([{ kind: "link", text: "ok", href: "https://etir.app" }]);
    const js = parseMarasAiInline("[bad](javascript:alert(1))");
    expect(js.every((n) => n.kind === "text")).toBe(true);
    expect(js[0]).toEqual({ kind: "text", text: "bad" });
    expect(parseMarasAiInline("[bad](data:text/html;x)")).toEqual([{ kind: "text", text: "bad" }]);
  });

  it("the node vocabulary is closed — every node is one of the typed kinds", () => {
    const blocks = parseMarasAiMarkdown("# H\n**b** `c` [l](https://x.y)\n- item");
    const kinds = new Set<string>();
    for (const b of blocks) {
      kinds.add(b.kind);
      const inlines = b.kind === "list" ? b.items.flat() : b.children;
      for (const n of inlines) kinds.add(n.kind);
    }
    for (const k of kinds) expect(["heading", "paragraph", "list", "text", "bold", "code", "link"]).toContain(k);
  });
});
