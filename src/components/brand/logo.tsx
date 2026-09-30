import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  // Fixed box via inline style: Tailwind's preflight sets `img { height: auto }`, which lets a
  // flex row stretch the mark to the row's full height (e.g. next to a long chat answer).
  return (
    <Image
      src="/brand/dossify-icon.png"
      alt=""
      width={size}
      height={size}
      priority
      style={{ width: size, height: size }}
      className={clsx("shrink-0 object-contain", className)}
    />
  );
}

// Wordmark is live text (Inter Bold) so it stays crisp and works on dark backgrounds too.
export function Logo({
  size = 32,
  tone = "dark",
  href = "/",
  className,
}: {
  size?: number;
  tone?: "dark" | "light";
  href?: string | null;
  className?: string;
}) {
  const content = (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span
        className={clsx("font-bold tracking-tight", tone === "light" ? "text-white" : "text-ink")}
        style={{ fontSize: size * 0.72 }}
      >
        Dossify
      </span>
    </span>
  );
  return href ? (
    <Link href={href} aria-label="Dossify home">
      {content}
    </Link>
  ) : (
    content
  );
}
