import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/ui/nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Wheels Up · Pre-flight checks for UK → EU freight",
  description:
    "Book a UK → EU pallet shipment by chat or spreadsheet, catch paperwork errors before collection, and get the carrier that fits your priority.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-3 text-ink" aria-label="Wheels Up home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wheelsup-logo.png" alt="Wheels Up" width={720} height={161} className="h-6 w-auto sm:h-7" />
              <span className="hidden border-l border-line pl-3 text-sm text-ink-3 md:inline">Pre-flight checks · UK → EU freight</span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-ink-3">
          Checks are deterministic: every rule, total and carrier ranking is computed by code from the official rate card and
          rulebook. AI is used only to understand chat messages.
        </footer>
      </body>
    </html>
  );
}
