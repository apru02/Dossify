import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { segmentMarkdown, segmentPages, segmentPlainText, type Segment } from "./chunk";

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB
export const ACCEPTED_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt"] as const;

export type ParsedDocument = { mimeType: string; pageCount: number | null; segments: Segment[] };

export class UnsupportedFileError extends Error {}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("binary");
    return text.replace(/^﻿/, "");
  } catch {
    throw new UnsupportedFileError("This file isn't valid UTF-8 text.");
  }
}

// File type is decided by extension AND content (magic bytes / UTF-8 validity), never by the
// browser-supplied MIME type alone.
export async function parseFile(name: string, bytes: Uint8Array): Promise<ParsedDocument> {
  const ext = extensionOf(name);

  if (ext === ".pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new UnsupportedFileError("This file has a .pdf extension but isn't a PDF.");
    }
    let pages: string[];
    try {
      // pdf.js transfers (detaches) the buffer it's given, so hand it a copy.
      const pdf = await getDocumentProxy(bytes.slice());
      ({ text: pages } = await extractText(pdf, { mergePages: false }));
    } catch {
      throw new UnsupportedFileError("This PDF couldn't be read. It may be encrypted or damaged.");
    }
    if (pages.join("").replace(/\s/g, "").length < 20) {
      throw new UnsupportedFileError("No selectable text found. Scanned PDFs (images) aren't supported yet.");
    }
    return { mimeType: "application/pdf", pageCount: pages.length, segments: segmentPages(pages) };
  }

  if (ext === ".md" || ext === ".markdown") {
    return { mimeType: "text/markdown", pageCount: null, segments: segmentMarkdown(decodeUtf8(bytes)) };
  }

  if (ext === ".txt") {
    return { mimeType: "text/plain", pageCount: null, segments: segmentPlainText(decodeUtf8(bytes)) };
  }

  throw new UnsupportedFileError(`Unsupported file type. Upload ${ACCEPTED_EXTENSIONS.join(", ")} files.`);
}
