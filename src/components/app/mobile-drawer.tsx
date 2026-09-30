"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

// Below md the sidebar becomes a slide-over drawer opened from a top bar.
export function MobileDrawer({ topBar, children }: { topBar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the drawer after navigation (React's "adjust state during render" pattern).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white px-4 md:hidden">
        {topBar}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="grid size-9 place-items-center rounded-lg text-ink hover:bg-canvas"
        >
          <Menu className="size-5" />
        </button>
      </div>

      <div
        className={clsx("fixed inset-0 z-40 bg-ink/30 transition-opacity md:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-white transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="absolute top-4 right-3 grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas md:hidden"
        >
          <X className="size-4" />
        </button>
        {children}
      </aside>
    </>
  );
}
