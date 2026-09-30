"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, FileText, ScrollText, Users } from "lucide-react";

export function SidebarNav({ workspaceId, showMembers }: { workspaceId: string; showMembers: boolean }) {
  const pathname = usePathname();
  const base = `/w/${workspaceId}`;
  const items = [
    { href: `${base}/documents`, label: "Documents", icon: FileText },
    { href: `${base}/tasks`, label: "Tasks", icon: CheckSquare },
    { href: `${base}/tool-logs`, label: "Tool Logs", icon: ScrollText },
    ...(showMembers ? [{ href: `${base}/members`, label: "Members", icon: Users }] : []),
  ];

  return (
    <nav className="space-y-1" aria-label="Workspace">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-lavender text-primary" : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
