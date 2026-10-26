import Link from "next/link";
import { RouteMotif } from "@/ui/route-motif";
import { ArrowRight, FileSpreadsheet, MessageSquareText, PlayCircle, ShieldCheck, Truck, Wrench } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-10 py-4">
      <section className="mx-auto max-w-3xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong ring-1 ring-inset ring-accent-line">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Pre-flight checks for UK → Germany, France & Netherlands
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Catch shipment mistakes <span className="text-accent-strong">before the truck leaves.</span>
        </h1>
        <p className="mt-4 text-lg text-ink-2">
          Every booking is checked against the 10-rule rulebook. Each problem comes with its evidence and a fix, and the carrier is chosen to fit the
          seller’s priority.
        </p>
        <div className="mt-8">
          <RouteMotif />
        </div>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2" aria-label="Start">
        <Link
          href="/book"
          className="group rounded-2xl bg-white p-6 ring-1 ring-line transition-all shadow-[0_1px_2px_rgba(15,27,45,0.04),0_8px_24px_-12px_rgba(15,27,45,0.10)] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/10 hover:ring-accent/50"
        >
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-white">
            <MessageSquareText className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="text-xl font-semibold">Book by chat</h2>
          <p className="mt-1 text-sm text-ink-2">Describe a shipment in plain words. We ask only for what’s missing and check it as you go.</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-strong">
            Start a booking <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
        <Link
          href="/check"
          className="group rounded-2xl bg-white p-6 ring-1 ring-line transition-all shadow-[0_1px_2px_rgba(15,27,45,0.04),0_8px_24px_-12px_rgba(15,27,45,0.10)] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/10 hover:ring-accent/50"
        >
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-ink text-white">
            <FileSpreadsheet className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="text-xl font-semibold">Check uploaded workbook</h2>
          <p className="mt-1 text-sm text-ink-2">Upload the Bookings + Items template. Get a review queue, most urgent first, with one-click fixes.</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-strong">
            Upload a workbook <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      </section>

      <section className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink bg-[radial-gradient(600px_160px_at_100%_50%,rgba(242,102,43,0.22),transparent_70%)] px-6 py-5 text-white">
        <div>
          <div className="text-lg font-semibold">See it on a real mistake</div>
          <p className="text-sm text-white/75">BK-003 has a quantity typo that breaks two rules. One evidence-backed fix clears both.</p>
        </div>
        <Link
          href="/check?demo=sample&open=BK-003"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink shadow-sm hover:brightness-105"
        >
          <PlayCircle className="h-4 w-4" aria-hidden /> View demo shipment
        </Link>
      </section>

      <section className="mx-auto grid max-w-4xl gap-6 text-sm sm:grid-cols-3">
        {[
          { icon: <ShieldCheck className="h-4 w-4" aria-hidden />, title: "Prevent, then detect", body: "Totals are calculated from the items in chat; uploads are checked line by line." },
          { icon: <Wrench className="h-4 w-4" aria-hidden />, title: "Fixes, not just flags", body: "Every issue shows its numbers, where it would fail and how sure the fix is." },
          { icon: <Truck className="h-4 w-4" aria-hidden />, title: "Carrier, explained", body: "Only services that can carry the pallet weight are ranked, with trade-offs in £ and days." },
        ].map((c) => (
          <div key={c.title}>
            <div className="flex items-center gap-2 font-semibold text-ink">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent-strong">{c.icon}</span>
              {c.title}
            </div>
            <p className="mt-1 text-ink-2">{c.body}</p>
          </div>
        ))}
      </section>

      <p className="text-center text-sm">
        <Link href="/how-it-works" className="font-medium text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
          How decisions are made
        </Link>
      </p>
    </div>
  );
}
