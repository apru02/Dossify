import { describe, expect, it } from "vitest";
import { chunkSegments, normalizeText, segmentMarkdown, segmentPages } from "./chunk";

const para = (n: number, len = 400) => `Paragraph ${n}. ` + "word ".repeat(Math.floor(len / 5));

describe("normalizeText", () => {
  it("re-joins hyphenated line breaks and collapses whitespace", () => {
    expect(normalizeText("exam-\nple  text\r\n\n\n\nnext")).toBe("example text\n\nnext");
  });
});

describe("chunkSegments", () => {
  it("returns nothing for empty input", () => {
    expect(chunkSegments([{ text: "  \n\n ", page: 1, section: null }])).toEqual([]);
  });

  it("keeps a short document in one chunk", () => {
    const chunks = chunkSegments([{ text: "Hello world.\n\nSecond paragraph.", page: null, section: null }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world.\n\nSecond paragraph.");
  });

  it("respects the size budget and indexes chunks in order", () => {
    const text = Array.from({ length: 20 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkSegments([{ text, page: null, section: null }], { targetChars: 1000, overlapChars: 200 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.content.length).toBeLessThanOrEqual(1000 + 450); // one unit may tip it over
    });
  });

  it("overlaps consecutive chunks without repeating whole chunks", () => {
    const text = Array.from({ length: 12 }, (_, i) => para(i, 150)).join("\n\n");
    const chunks = chunkSegments([{ text, page: null, section: null }], { targetChars: 600, overlapChars: 200 });
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1].content.split("\n\n").at(-1)!;
      expect(chunks[i].content.startsWith(prevLast)).toBe(true);
      expect(chunks[i].content).not.toBe(chunks[i - 1].content);
    }
  });

  it("never loses text: every paragraph appears in some chunk", () => {
    const paras = Array.from({ length: 15 }, (_, i) => para(i, 300));
    const chunks = chunkSegments([{ text: paras.join("\n\n"), page: null, section: null }], { targetChars: 800 });
    const all = chunks.map((c) => c.content).join("\n\n");
    paras.forEach((p) => expect(all).toContain(p.trim()));
  });

  it("splits an oversized paragraph (no blank lines) into bounded pieces", () => {
    const wall = "This is a sentence without breaks. ".repeat(300);
    const chunks = chunkSegments([{ text: wall, page: 1, section: null }], { targetChars: 1000 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(1000 * 2 + 10));
  });

  it("never lets a chunk span two PDF pages, even when pages are short", () => {
    const pages = ["Title page.", para(2, 300), para(3, 2500)];
    const chunks = chunkSegments(segmentPages(pages), { targetChars: 1000 });
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 1, content: "Title page." });
    expect(chunks[1]).toMatchObject({ pageStart: 2, pageEnd: 2 });
    expect(chunks.slice(2).every((c) => c.pageStart === 3 && c.pageEnd === 3)).toBe(true);
    expect(chunks.length).toBeGreaterThan(3); // page 3 still splits by size
  });
});

describe("segmentMarkdown", () => {
  const md = `# Handbook\nIntro text.\n\n## Leave policy\nYou get 24 days.\n\n### Carry over\nFive days.\n\n## Expenses\n\`\`\`\n# not a heading\n\`\`\`\nSubmit in 30 days.`;

  it("records the heading path as the section", () => {
    const sections = segmentMarkdown(md).map((s) => s.section);
    expect(sections).toEqual([
      "Handbook",
      "Handbook › Leave policy",
      "Handbook › Leave policy › Carry over",
      "Handbook › Expenses",
    ]);
  });

  it("ignores # lines inside code fences", () => {
    expect(segmentMarkdown(md).at(-1)!.text).toContain("# not a heading");
  });

  it("starts a new chunk at a section boundary once the chunk is reasonably full", () => {
    const big = `## A\n${para(1, 900)}\n\n## B\n${para(2, 900)}`;
    const chunks = chunkSegments(segmentMarkdown(big), { targetChars: 2000 });
    expect(chunks.map((c) => c.section)).toEqual(["A", "B"]);
    expect(chunks[1].content).not.toContain("Paragraph 1.");
  });
});
