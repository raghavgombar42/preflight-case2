"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, FlaskConical, Search, Upload } from "lucide-react";
import { Analysis, analyze } from "@/core/analyze";
import { RULES, RuleId } from "@/core/config";
import { Booking } from "@/core/model";
import { istToday, gbp } from "@/core/values";
import { ParseResult, UnmatchedItem, parseWorkbook } from "@/core/workbook";
import { Workspace, commit, newWorkspace, resetToOriginal, undo } from "@/core/workspace";
import { BookingView } from "@/ui/booking-view";
import { Button, Card, CardHead, VerdictChip, cx } from "@/ui/bits";
import { load, save, clear } from "@/ui/persist";

type Session = {
  fileName: string;
  uploadedAt: string;
  workspaces: Workspace[];
  unmatchedItems: UnmatchedItem[];
  fileNotes: string[];
  duplicateRefs: string[];
};

const KEY = "preflight.check.v1";
const ORDER = { blocked: 0, incomplete: 1, warnings: 2, passed: 3 } as const;

export function CheckApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    setToday(istToday());
    const s = load<Session>(KEY);
    if (s && Array.isArray(s.workspaces)) setSession(s);
    const fromHash = decodeURIComponent(window.location.hash.slice(1));
    if (fromHash) setSelected(fromHash);
    loaded.current = true;
    const onHash = () => setSelected(decodeURIComponent(window.location.hash.slice(1)) || null);
    window.addEventListener("hashchange", onHash);
    const t = setInterval(() => setToday(istToday()), 60_000);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (loaded.current && session) save(KEY, session);
  }, [session]);

  const open = (uid: string | null) => {
    if (uid) window.location.hash = encodeURIComponent(uid);
    else history.pushState(null, "", window.location.pathname);
    setSelected(uid);
    window.scrollTo({ top: 0 });
  };

  const ingest = useCallback((fileName: string, r: ParseResult) => {
    if (r.fileErrors.length && r.bookings.length === 0) {
      setError(r.fileErrors.join(" "));
      return;
    }
    setError(r.fileErrors.length ? r.fileErrors.join(" ") : null);
    setSession({
      fileName,
      uploadedAt: new Date().toISOString(),
      workspaces: r.bookings.map(newWorkspace),
      unmatchedItems: r.unmatchedItems,
      fileNotes: r.fileNotes,
      duplicateRefs: r.duplicateRefs,
    });
    open(null);
  }, []);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        setError(`"${file.name}" isn't an Excel workbook. Upload the .xlsx template with the Bookings and Items sheets.`);
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setError("That file is larger than 15 MB. The template is normally well under 1 MB.");
        return;
      }
      const buf = await file.arrayBuffer();
      ingest(file.name, parseWorkbook(buf));
    } catch (e) {
      setError(`Could not read the file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/sample-bookings.xlsx");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ingest("sample-bookings.xlsx (sample with planted errors)", parseWorkbook(await res.arrayBuffer()));
    } catch (e) {
      setError(`Could not load the sample: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const analyses = useMemo(() => {
    const m = new Map<string, Analysis>();
    if (today) session?.workspaces.forEach((w) => m.set(w.current.uid, analyze(w.current, today)));
    return m;
  }, [session, today]);

  const updateWs = (uid: string, fn: (w: Workspace) => Workspace) =>
    setSession((s) => (s ? { ...s, workspaces: s.workspaces.map((w) => (w.current.uid === uid ? fn(w) : w)) } : s));

  if (!today) return <div className="p-8 text-ink-3">Loading…</div>;
  if (!session) return <UploadPanel onFile={onFile} onSample={loadSample} busy={busy} error={error} />;

  const ws = selected ? session.workspaces.find((w) => w.current.uid === selected) : null;
  if (ws) {
    const a = analyses.get(ws.current.uid)!;
    return (
      <div className="space-y-4">
        <button className="no-print inline-flex items-center gap-1 text-sm font-medium text-brand" onClick={() => open(null)}>
          <ArrowLeft className="h-4 w-4" /> Review queue
        </button>
        <BookingView
          ws={ws}
          analysis={a}
          onCommit={(next: Booking, label, source) => updateWs(ws.current.uid, (w) => commit(w, next, label, source, today))}
          onUndo={() => updateWs(ws.current.uid, undo)}
          onReset={() => updateWs(ws.current.uid, resetToOriginal)}
          onAcknowledge={(key, on) =>
            updateWs(ws.current.uid, (w) => ({ ...w, acknowledged: on ? [...new Set([...w.acknowledged, key])] : w.acknowledged.filter((k) => k !== key) }))
          }
        />
      </div>
    );
  }

  return (
    <Queue
      session={session}
      analyses={analyses}
      onOpen={open}
      onNew={() => {
        clear(KEY);
        setSession(null);
        setError(null);
      }}
      error={error}
    />
  );
}

function UploadPanel({ onFile, onSample, busy, error }: { onFile: (f: File) => void; onSample: () => void; busy: boolean; error: string | null }) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload & review bookings</h1>
        <p className="mt-1 text-ink-2">
          Upload the Bookings + Items workbook (official template format). Every booking is checked against all 10 rules, gets a carrier
          recommendation, and lands in a review queue sorted by urgency.
        </p>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cx(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          drag ? "border-brand bg-brand-soft" : "border-grey-line bg-white"
        )}
      >
        <FileSpreadsheet className="h-10 w-10 text-brand" />
        <div className="font-medium">Drop the .xlsx here, or choose a file</div>
        <div className="text-sm text-ink-3">Processed in your browser. Nothing is stored on a server.</div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> {busy ? "Reading…" : "Choose file"}
          </Button>
          <Button onClick={onSample} disabled={busy}>
            <FlaskConical className="h-4 w-4" /> Try sample data
          </Button>
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-line bg-red-soft px-4 py-3 text-sm text-red">{error}</div>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <a className="inline-flex items-center gap-1 font-medium text-brand" href="/Case2_Shipment_Booking_Test_Data_Format.xlsx" download>
          <Download className="h-4 w-4" /> Download blank template
        </a>
        <a className="inline-flex items-center gap-1 font-medium text-brand" href="/sample-bookings.xlsx" download>
          <Download className="h-4 w-4" /> Download sample workbook
        </a>
      </div>
    </div>
  );
}

function Queue({
  session,
  analyses,
  onOpen,
  onNew,
  error,
}: {
  session: Session;
  analyses: Map<string, Analysis>;
  onOpen: (uid: string) => void;
  onNew: () => void;
  error: string | null;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | keyof typeof ORDER>("all");
  const rows = session.workspaces
    .map((w) => ({ w, a: analyses.get(w.current.uid)! }))
    .filter((r) => r.a)
    .sort((x, y) => ORDER[x.a.verdict] - ORDER[y.a.verdict] || (x.w.current.sourceRow ?? 0) - (y.w.current.sourceRow ?? 0));
  const counts = { blocked: 0, incomplete: 0, warnings: 0, passed: 0 };
  const ruleHits = new Map<string, number>();
  for (const r of rows) {
    counts[r.a.verdict]++;
    for (const id of new Set(r.a.findings.map((f) => f.ruleId))) ruleHits.set(id, (ruleHits.get(id) ?? 0) + 1);
  }
  const top = [...ruleHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.a.verdict === filter) &&
      (!q ||
        `${r.w.current.ref.value} ${r.w.current.sellerName.value} ${r.w.current.destCity.value}`.toLowerCase().includes(q.toLowerCase()))
  );
  const label = (id: string) => (id === "DATA" ? "Missing details" : `${id} ${RULES.find((r) => r.id === (id as RuleId))?.short ?? ""}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="text-sm text-ink-3">
            {session.fileName} · {rows.length} booking{rows.length === 1 ? "" : "s"} · checked {new Date(session.uploadedAt).toLocaleString("en-GB")}
          </p>
        </div>
        <Button onClick={onNew}>
          <Upload className="h-4 w-4" /> Upload another file
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["blocked", "incomplete", "warnings", "passed"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilter(filter === v ? "all" : v)}
            className={cx("rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm", filter === v ? "border-brand ring-2 ring-brand/20" : "border-line")}
          >
            <div className="text-2xl font-semibold tnum">{counts[v]}</div>
            <VerdictChip verdict={v} className="mt-1" />
          </button>
        ))}
      </div>

      {top.length > 0 && (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
          <span className="font-medium">Most common issues: </span>
          {top.map(([id, n], i) => (
            <span key={id} className="text-ink-2">
              {i > 0 && " · "}
              {label(id)} ({n} booking{n > 1 ? "s" : ""})
            </span>
          ))}
        </div>
      )}

      {(error || session.unmatchedItems.length > 0 || session.fileNotes.length > 0 || session.duplicateRefs.length > 0) && (
        <Card>
          <CardHead title="File notices" />
          <ul className="space-y-1 px-4 py-3 text-sm text-ink-2">
            {error && <li className="text-red">{error}</li>}
            {session.duplicateRefs.map((r) => (
              <li key={r}>Booking ID {r} appears more than once. Each copy is shown; items were matched to the first.</li>
            ))}
            {session.unmatchedItems.map((u) => (
              <li key={u.sourceRow}>
                Items sheet row {u.sourceRow}: {u.sku ?? u.description ?? "item"} refers to booking &quot;{u.bookingRef}&quot;, which isn&apos;t on the Bookings sheet.
              </li>
            ))}
            {session.fileNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">
            Bookings {filter !== "all" && <span className="font-normal text-ink-3">· filtered</span>}
          </h2>
          <label className="flex items-center gap-2 rounded-md border border-grey-line px-2 py-1 text-sm">
            <Search className="h-3.5 w-3.5 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, seller, city" className="w-44 outline-none" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-canvas text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Booking</th>
                <th className="px-4 py-2 font-medium">Route</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Issues</th>
                <th className="px-4 py-2 font-medium">Carrier</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map(({ w, a }) => {
                const b = w.current;
                const first = a.findings[0];
                return (
                  <tr key={b.uid} className="cursor-pointer hover:bg-brand-soft/40" onClick={() => onOpen(b.uid)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-brand">{b.ref.value ?? "(no ID)"}</div>
                      <div className="text-xs text-ink-3">
                        {b.sellerName.value ?? "—"}
                        {w.history.length > 0 && <span className="ml-1 text-amber">· edited</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {b.originCity.value ?? "?"} → {b.destCity.value ?? "?"}
                      <div className="text-xs text-ink-3">{b.sellerPriority.value ?? "no priority"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <VerdictChip verdict={a.verdict} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 text-xs">
                        {a.counts.red > 0 && <span className="rounded bg-red-soft px-1.5 py-0.5 font-medium text-red">{a.counts.red} red</span>}
                        {a.counts.amber > 0 && <span className="rounded bg-amber-soft px-1.5 py-0.5 font-medium text-amber">{a.counts.amber} amber</span>}
                        {a.counts.incomplete > 0 && <span className="rounded bg-grey-soft px-1.5 py-0.5 font-medium text-grey">{a.counts.incomplete} missing</span>}
                        {a.findings.length === 0 && <span className="text-ink-3">None</span>}
                      </div>
                      {first && <div className="mt-1 max-w-xs truncate text-xs text-ink-3">{first.ruleId}: {first.title}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {a.carrier.selected ? `${a.carrier.selected.option.carrier} ${a.carrier.selected.option.shortName}` : <span className="text-ink-3">{a.carrier.status === "no-eligible" ? "None eligible" : "Pending"}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tnum">{a.carrier.selected ? gbp(a.carrier.selected.totalCost, 0) : "—"}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-3">
                    No bookings match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
