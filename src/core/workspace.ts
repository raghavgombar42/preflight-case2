// A booking under review: the frozen original, the working copy, undo
// history and a change log that records what each change did to the
// findings, verdict and carrier.

import { Analysis, analyze, describeKey } from "./analyze";
import { FieldChange, diffBookings } from "./edit";
import { Booking } from "./model";

export type LogEntry = {
  at: string;
  label: string;
  source: "fix" | "edit" | "chat" | "scenario";
  changes: FieldChange[];
  verdictBefore: Analysis["verdict"];
  verdictAfter: Analysis["verdict"];
  carrierBefore: string | null;
  carrierAfter: string | null;
  resolved: string[];
  introduced: string[];
  resolvedKeys: string[];
  introducedKeys: string[];
};

export type Workspace = {
  original: Booking;
  current: Booking;
  history: Booking[];
  log: LogEntry[];
  acknowledged: string[];
};

export function newWorkspace(b: Booking): Workspace {
  return { original: b, current: b, history: [], log: [], acknowledged: [] };
}

const carrierName = (a: Analysis) => (a.carrier.selected ? `${a.carrier.selected.option.carrier} ${a.carrier.selected.option.shortName}` : null);

export function commit(ws: Workspace, next: Booking, label: string, source: LogEntry["source"], today: string): Workspace {
  const changes = diffBookings(ws.current, next);
  if (changes.length === 0) return ws;
  const before = analyze(ws.current, today);
  const after = analyze(next, today);
  const bk = new Set(before.findings.map((f) => f.key));
  const ak = new Set(after.findings.map((f) => f.key));
  const entry: LogEntry = {
    at: new Date().toISOString(),
    label,
    source,
    changes,
    verdictBefore: before.verdict,
    verdictAfter: after.verdict,
    carrierBefore: carrierName(before),
    carrierAfter: carrierName(after),
    resolvedKeys: [...bk].filter((k) => !ak.has(k)),
    introducedKeys: [...ak].filter((k) => !bk.has(k)),
    resolved: summarise([...bk].filter((k) => !ak.has(k)), before, "filled"),
    introduced: summarise([...ak].filter((k) => !bk.has(k)), after, "now missing"),
  };
  return {
    ...ws,
    current: next,
    history: [...ws.history, ws.current].slice(-50),
    log: [entry, ...ws.log].slice(0, 100),
  };
}

// Rule findings are listed individually; missing-detail findings are counted.
function summarise(keys: string[], a: Analysis, verb: string): string[] {
  const rules = keys.filter((k) => !k.startsWith("DATA:")).map((k) => describeKey(k, a.findings));
  const data = keys.filter((k) => k.startsWith("DATA:")).length;
  return data ? [...rules, `${data} detail${data > 1 ? "s" : ""} ${verb}`] : rules;
}

export function undo(ws: Workspace): Workspace {
  if (!ws.history.length) return ws;
  const prev = ws.history[ws.history.length - 1];
  return { ...ws, current: prev, history: ws.history.slice(0, -1), log: ws.log.slice(1) };
}

export function resetToOriginal(ws: Workspace): Workspace {
  return newWorkspace(ws.original);
}
