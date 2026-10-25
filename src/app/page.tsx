import Link from "next/link";
import { ArrowRight, FileSpreadsheet, MessageSquareText, ShieldCheck, Truck, Wrench } from "lucide-react";
import { RULES } from "@/core/config";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-line bg-white px-6 py-10 sm:px-10">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
            <ShieldCheck className="h-3.5 w-3.5" /> Pre-flight checks for UK → Germany, France & Netherlands
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Catch paperwork mistakes before the shipment leaves, not at customs.</h1>
          <p className="mt-3 text-lg text-ink-2">
            Book a pallet shipment by chatting or by uploading a spreadsheet. Every booking is checked against the 10-rule rulebook, each problem
            comes with its evidence and a fix, and the carrier is chosen to match what matters most to the seller.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/book" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800">
              <MessageSquareText className="h-4 w-4" /> Start a booking by chat
            </Link>
            <Link href="/check" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-ink ring-1 ring-inset ring-grey-line hover:bg-grey-soft">
              <FileSpreadsheet className="h-4 w-4" /> Upload bookings (.xlsx)
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: <ShieldCheck className="h-5 w-5" />,
            title: "Prevent, then detect",
            body: "In chat, totals are calculated from the items so they can't drift. Uploaded sheets are checked line by line, with the exact row for every problem.",
          },
          {
            icon: <Wrench className="h-5 w-5" />,
            title: "Fixes, not just flags",
            body: "Each issue shows the numbers behind it, where the shipment would fail, and a fix labelled by how certain it is. One click previews what it clears.",
          },
          {
            icon: <Truck className="h-5 w-5" />,
            title: "The right carrier, explained",
            body: "Only services that can legally carry the pallet weight are ranked. Cheapest, fastest, most reliable or balanced, with the trade-offs in pounds and days.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-line bg-white p-5">
            <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">{c.icon}</div>
            <div className="font-semibold">{c.title}</div>
            <p className="mt-1 text-sm text-ink-2">{c.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">The 10 checks every booking goes through</h2>
          <Link href="/how-it-works" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
            How decisions are made <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
          {RULES.map((r) => (
            <li key={r.id} className="flex items-start gap-3 border-line px-5 py-3 text-sm sm:border-b">
              <span className="mt-0.5 rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{r.id}</span>
              <div>
                <div className="text-ink">{r.rule}</div>
                <div className="text-xs text-ink-3">
                  <span className={r.severity === "red" ? "text-red" : "text-amber"}>{r.severity === "red" ? "Red: blocks" : "Amber: warning"}</span> · fails at{" "}
                  {r.stage.toLowerCase()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
