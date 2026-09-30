// Pure text → chunks logic (no I/O), so it's unit-tested in chunk.test.ts.
//
// Strategy: split into paragraph-sized units that remember their page and section, then pack
// units greedily into ~2,000-char chunks (~500 tokens) with ~300 chars of overlap. Chunks always
// break at PDF page boundaries (precise page citations) and at section boundaries when they're
// already reasonably full, so a chunk rarely mixes topics.

export type Segment = { text: string; page: number | null; section: string | null };

export type Chunk = {
  index: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  section: string | null;
  tokenCount: number;
};

export type ChunkOptions = { targetChars?: number; maxChars?: number; overlapChars?: number };

type Unit = Segment;

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2") // re-join words hyphenated across PDF line breaks
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Break a long paragraph into sentence-ish pieces no longer than maxChars.
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)\s*/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) {
        out.push(buf.trim());
        buf = "";
      }
      // Hard split at word boundaries when a single "sentence" is huge (tables, minified text).
      let i = 0;
      while (i < s.length) {
        let end = Math.min(i + maxChars, s.length);
        const space = s.lastIndexOf(" ", end);
        if (end < s.length && space > i + maxChars / 2) end = space;
        out.push(s.slice(i, end).trim());
        i = end;
      }
    } else if ((buf + s).length > maxChars) {
      out.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function toUnits(segments: Segment[], maxChars: number): Unit[] {
  const units: Unit[] = [];
  for (const seg of segments) {
    const paragraphs = normalizeText(seg.text).split(/\n\s*\n/);
    for (const p of paragraphs) {
      const para = p.replace(/\n/g, " ").trim();
      if (!para) continue;
      for (const piece of splitLong(para, maxChars)) units.push({ ...seg, text: piece });
    }
  }
  return units;
}

export function chunkSegments(segments: Segment[], opts: ChunkOptions = {}): Chunk[] {
  const targetChars = opts.targetChars ?? 2000;
  const maxChars = opts.maxChars ?? Math.round(targetChars * 1.2);
  const overlapChars = opts.overlapChars ?? 300;

  const units = toUnits(segments, Math.min(maxChars, targetChars));
  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let currentLen = 0;
  let fresh = 0; // units in `current` that are not overlap from the previous chunk

  const emit = () => {
    if (fresh === 0) return;
    const pages = current.map((u) => u.page).filter((p): p is number => p !== null);
    const content = current.map((u) => u.text).join("\n\n");
    chunks.push({
      index: chunks.length,
      content,
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
      section: current.find((u, i) => i >= current.length - fresh)?.section ?? current[0]?.section ?? null,
      tokenCount: estimateTokens(content),
    });
    // Carry trailing units forward as overlap (never the whole chunk).
    const carry: Unit[] = [];
    let carryLen = 0;
    for (let i = current.length - 1; i > 0; i--) {
      if (carryLen + current[i].text.length > overlapChars) break;
      carry.unshift(current[i]);
      carryLen += current[i].text.length;
    }
    current = carry;
    currentLen = carryLen;
    fresh = 0;
  };

  for (const unit of units) {
    const last = current[current.length - 1];
    const sectionChanged = last && fresh > 0 && unit.section !== last.section;
    // Page breaks are hard boundaries so every PDF citation points at exactly one page.
    const pageChanged = last && fresh > 0 && unit.page !== last.page;
    if (pageChanged || (sectionChanged && currentLen >= targetChars * 0.4)) {
      emit();
      current = []; // don't carry overlap across a section boundary
      currentLen = 0;
    } else if (fresh > 0 && currentLen + unit.text.length > targetChars) {
      emit();
    }
    current.push(unit);
    currentLen += unit.text.length;
    fresh++;
  }
  emit();
  return chunks;
}

// Markdown: track the heading path ("Handbook › Leave policy") as the section.
export function segmentMarkdown(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const stack: { level: number; title: string }[] = [];
  let buf: string[] = [];
  const section = () => (stack.length ? stack.map((h) => h.title).join(" › ") : null);
  const flush = () => {
    if (buf.join("").trim()) segments.push({ text: buf.join("\n"), page: null, section: section() });
    buf = [];
  };
  let inFence = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: h[2].replace(/[*_`]/g, "").slice(0, 120) });
      buf.push(h[2]); // keep the heading text in the chunk too; it helps retrieval
    } else {
      buf.push(line);
    }
  }
  flush();
  return segments;
}

export function segmentPages(pages: string[]): Segment[] {
  return pages.map((text, i) => ({ text, page: i + 1, section: null }));
}

export function segmentPlainText(text: string): Segment[] {
  return [{ text, page: null, section: null }];
}
