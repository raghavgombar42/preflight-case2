"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/book", label: "New booking", short: "Book" },
  { href: "/check", label: "Upload & review", short: "Upload" },
  { href: "/how-it-works", label: "How it works", short: "How" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="ml-auto flex items-center gap-0.5 whitespace-nowrap text-sm sm:gap-1">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-2 py-1.5 font-medium transition-colors sm:px-2.5 ${
              active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-grey-soft hover:text-ink"
            }`}
          >
            <span className="sm:hidden">{l.short}</span>
            <span className="hidden sm:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
