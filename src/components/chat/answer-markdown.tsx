"use client";

import Markdown from "react-markdown";

// Turn "[1]" / "[1, 3]" into links we can render as citation chips.
function linkCitations(text: string) {
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, nums: string) =>
    nums
      .split(",")
      .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
      .join(""),
  );
}

// react-markdown never renders raw HTML from the model, so document text can't inject markup.
export function AnswerMarkdown({ content, onCite }: { content: string; onCite: (n: number) => void }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_code]:rounded [&_code]:bg-canvas [&_code]:px-1 [&_strong]:font-semibold">
      <Markdown
        components={{
          a: ({ href, children }) => {
            const cite = href?.match(/^#cite-(\d+)$/);
            if (cite) {
              return (
                <button
                  type="button"
                  onClick={() => onCite(Number(cite[1]))}
                  className="mx-0.5 inline-grid h-5 min-w-5 place-items-center rounded-md bg-lavender px-1 align-text-top text-[11px] font-semibold text-primary hover:bg-primary hover:text-white"
                  aria-label={`Show source ${cite[1]}`}
                >
                  {cite[1]}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
                {children}
              </a>
            );
          },
          p: ({ children }) => <p>{children}</p>,
        }}
      >
        {linkCitations(content)}
      </Markdown>
    </div>
  );
}
