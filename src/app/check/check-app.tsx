"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, FlaskConical, Search, Upload } from "lucide-react";
import { Analysis, analyze } from "@/core/analyze";
import { batchAction } from "@/core/batch";
import { RULES, RuleId } from "@/core/config";
import { Booking } from "@/core/model";
import { istToday, gbp } from "@/core/values";
import { ParseResult, UnmatchedItem, parseWorkbook } from "@/core/workbook";
import { Workspace, commit, newWorkspace, resetToOriginal, undo } from "@/core/workspace";
import { BookingView } from "@/ui/booking-view";
import { Button, Card, VERDICT_STYLE, cx } from "@/ui/bits";
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
    // Demo links: /check?demo=sample loads the sample workbook; &open=BK-003 opens that booking.
    const q = new URLSearchParams(window.location.search);
    if (q.get("demo") === "sample") {
      fetch("/sample-bookings.xlsx")
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const r = parseWorkbook(buf);
          const workspaces = r.bookings.map(newWorkspace);
          setSession({
            fileName: "sample-bookings.xlsx (sample with planted errors)",
            uploadedAt: new Date().toISOString(),
            workspaces,
            unmatchedItems: r.unmatchedItems,
            fileNotes: r.fileNotes,
            duplicateRefs: r.duplicateRefs,
          });
          const ref = q.get("open");
          const hit = ref ? workspaces.find((w) => w.current.ref.value === ref) : undefined;
          setSelected(hit ? hit.current.uid : null);
          history.replaceState(null, "", window.location.pathname + (hit ? `#${hit.current.uid}` : ""));
        })
        .catch(() => setError("Could not load the sample workbook."));
    }
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
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Check a bookings workbook</h1>
        <p className="mt-2 text-ink-2">
          Upload the Bookings + Items workbook in the official template. Every booking is checked against the 10-rule rulebook and lands in a
          review queue, most urgent first.
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
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          drag ? "border-brand bg-brand-soft" : "border-grey-line bg-white"
        )}
      >
        <FileSpreadsheet className="h-10 w-10 text-brand" aria-hidden />
        <div className="text-lg font-medium">Drop the .xlsx here, or choose a file</div>
        <div className="text-sm text-ink-3">Read in your browser. Nothing is stored on a server.</div>
        <input
          ref={input}
          type="file"
          aria-label="Choose a bookings workbook"
          accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" aria-hidden /> {busy ? "Reading…" : "Choose file"}
          </Button>
          <Button onClick={onSample} disabled={busy}>
            <FlaskConical className="h-4 w-4" aria-hidden /> Try the sample workbook
          </Button>
        </div>
      </div>
      <div aria-live="polite">
        {busy && <p className="text-sm text-ink-3">Reading the workbook…</p>}
        {error && <div className="rounded-lg border border-red-line bg-red-soft px-4 py-3 text-sm text-red">{error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <a className="inline-flex items-center gap-1 font-medium text-brand" href="/Case2_Shipment_Booking_Test_Data_Format.xlsx" download>
          <Download className="h-4 w-4" aria-hidden /> Blank template
        </a>
        <a className="inline-flex items-center gap-1 font-medium text-brand" href="/sample-bookings.xlsx" download>
          <Download className="h-4 w-4" aria-hidden /> Sample workbook (15 bookings, planted mistakes)
        </a>
      </div>
    </div>
  );
}

const STATUS_BAR: Record<keyof typeof ORDER, string> = {
  blocked: "bg-red",
  incomplete: "bg-grey",
  warnings: "bg-amber",
  passed: "bg-green",
};
const ROW_EDGE: Record<keyof typeof ORDER, string> = {
  blocked: "border-l-red",
  incomplete: "border-l-grey",
  warnings: "border-l-amber",
  passed: "border-l-green",
};

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
  const top = [...ruleHits.entries()].sort((a, b) => b[1] - a[1])[0];
  const action = batchAction(rows.map((r) => ({ uid: r.w.current.uid, ref: r.w.current.ref.value ?? "(no ID)", analysis: r.a })));
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.a.verdict === filter) &&
      (!q || `${r.w.current.ref.value} ${r.w.current.sellerName.value} ${r.w.current.destCity.value}`.toLowerCase().includes(q.toLowerCase()))
  );
  const label = (id: string) => (id === "DATA" ? "Missing details" : `${id} · ${RULES.find((r) => r.id === (id as RuleId))?.short ?? ""}`);
  const total = rows.length || 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-3">{session.fileName}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {rows.length} booking{rows.length === 1 ? "" : "s"} checked
          </h1>
        </div>
        <Button onClick={onNew}>
          <Upload className="h-4 w-4" aria-hidden /> Upload another file
        </Button>
      </div>

      <Card className="p-5">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-grey-soft"
          role="img"
          aria-label={`${counts.blocked} blocked, ${counts.incomplete} missing details, ${counts.warnings} need review, ${counts.passed} ready`}
        >
          {(["blocked", "incomplete", "warnings", "passed"] as const).map((v) =>
            counts[v] ? <div key={v} className={STATUS_BAR[v]} style={{ width: `${(counts[v] / total) * 100}%` }} /> : null
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filter by status">
          {(["blocked", "incomplete", "warnings", "passed"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilter(filter === v ? "all" : v)}
              aria-pressed={filter === v}
              className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", filter === v ? "bg-brand-soft ring-2 ring-brand/40" : "hover:bg-canvas")}
            >
              <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_BAR[v])} aria-hidden />
              <span className="text-2xl font-semibold tnum">{counts[v]}</span>
              <span className="text-sm text-ink-2">{VERDICT_STYLE[v].label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm text-ink-2">
          <p>
            {action.sentence}{" "}
            {action.start && (
              <button className="font-medium text-brand hover:underline" onClick={() => onOpen(action.start!.uid)}>
                {action.start.text} →
              </button>
            )}
          </p>
          {top && (
            <p>
              <span className="font-medium text-ink">Most common issue:</span> {label(top[0])} in {top[1]} booking{top[1] > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </Card>

      {(error || session.unmatchedItems.length > 0 || session.fileNotes.length > 0 || session.duplicateRefs.length > 0) && (
        <div className="rounded-xl bg-amber-soft/60 px-5 py-3 text-sm text-ink-2" aria-live="polite">
          <div className="mb-1 font-medium text-ink">File notices</div>
          <ul className="space-y-1">
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
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Review queue {filter !== "all" && <span className="font-normal text-ink-3">· {VERDICT_STYLE[filter].label}</span>}
          </h2>
          <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-line">
            <Search className="h-3.5 w-3.5 text-ink-3" aria-hidden />
            <span className="sr-only">Search bookings</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, seller, city" className="w-44 bg-transparent outline-none" />
          </label>
        </div>
        <ul className="space-y-2">
          {shown.map(({ w, a }) => {
            const b = w.current;
            const first = a.findings[0];
            const s = VERDICT_STYLE[a.verdict];
            return (
              <li key={b.uid}>
                <button
                  onClick={() => onOpen(b.uid)}
                  aria-label={`Open booking ${b.ref.value ?? "without ID"}: ${s.label}${first ? `. Top issue: ${first.title}` : ""}`}
                  className={cx(
                    "grid w-full grid-cols-1 gap-x-4 gap-y-1 rounded-xl border border-line border-l-4 bg-white px-4 py-3 text-left transition-shadow hover:shadow-md sm:grid-cols-[140px_190px_minmax(0,1fr)_190px]",
                    ROW_EDGE[a.verdict]
                  )}
                >
                  <div>
                    <div className="font-semibold text-brand">{b.ref.value ?? "(no ID)"}</div>
                    <div className="truncate text-xs text-ink-3">
                      {b.sellerName.value ?? "—"}
                      {w.history.length > 0 && <span className="ml-1 text-amber">· edited</span>}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", s.chip)}>
                      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
                        {s.icon}
                      </span>
                      {s.label}
                    </span>
                  </div>
                  <div className="min-w-0 text-sm">
                    {first ? (
                      <>
                        <span className="font-medium text-ink">{first.ruleId === "DATA" ? "Missing" : first.ruleId}: </span>
                        <span className="text-ink-2">{first.title}</span>
                        {a.findings.length > 1 && <span className="text-ink-3"> · +{a.findings.length - 1} more</span>}
                      </>
                    ) : (
                      <span className="text-ink-3">No issues</span>
                    )}
                  </div>
                  <div className="text-sm text-ink-2 sm:text-right">
                    {a.carrier.selected ? (
                      <>
                        {a.carrier.selected.option.carrier} {a.carrier.selected.option.shortName} ·{" "}
                        <span className="tnum">{gbp(a.carrier.selected.totalCost, 0)}</span>
                      </>
                    ) : (
                      <span className="text-ink-3">{a.carrier.status === "no-eligible" ? "No eligible carrier" : "Carrier pending"}</span>
                    )}
                    <div className="text-xs text-ink-3">
                      {b.originCity.value ?? "?"} → {b.destCity.value ?? "?"}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="rounded-xl bg-white px-4 py-8 text-center text-ink-3">No bookings match.</li>}
        </ul>
      </div>
    </div>
  );
}
