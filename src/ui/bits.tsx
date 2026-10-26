"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, MinusCircle, OctagonX } from "lucide-react";
import type { Verdict } from "@/core/analyze";
import type { RuleStatus, Confidence, Finding } from "@/core/rules";
import type { FieldSource } from "@/core/model";

export function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export const VERDICT_STYLE: Record<Verdict, { label: string; chip: string; banner: string; icon: React.ReactNode }> = {
  blocked: {
    label: "Blocked",
    chip: "bg-red-soft text-red ring-red-line",
    banner: "border-red-line bg-red-soft text-red",
    icon: <OctagonX className="h-5 w-5" aria-hidden />,
  },
  incomplete: {
    label: "Missing details",
    chip: "bg-grey-soft text-grey ring-grey-line",
    banner: "border-grey-line bg-grey-soft text-grey",
    icon: <CircleDashed className="h-5 w-5" aria-hidden />,
  },
  warnings: {
    label: "Needs review",
    chip: "bg-amber-soft text-amber ring-amber-line",
    banner: "border-amber-line bg-amber-soft text-amber",
    icon: <AlertTriangle className="h-5 w-5" aria-hidden />,
  },
  passed: {
    label: "Ready for booking",
    chip: "bg-green-soft text-green ring-green-line",
    banner: "border-green-line bg-green-soft text-green",
    icon: <CheckCircle2 className="h-5 w-5" aria-hidden />,
  },
};

export function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", s.chip, className)}>
      {s.label}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  const map = {
    red: "bg-red text-white",
    amber: "bg-amber text-white",
    incomplete: "bg-grey text-white",
  } as const;
  const label = { red: "Red · blocks", amber: "Amber · warning", incomplete: "Missing detail" }[severity];
  return <span className={cx("inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", map[severity])}>{label}</span>;
}

export function RuleChip({ id }: { id: string }) {
  return (
    <span className="inline-flex rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{id === "DATA" ? "DATA" : id}</span>
  );
}

const CONF = {
  arithmetic: { label: "Arithmetic correction", cls: "bg-brand-soft text-brand ring-brand/20" },
  evidence: { label: "Evidence-supported", cls: "bg-green-soft text-green ring-green-line" },
  confirm: { label: "Needs seller confirmation", cls: "bg-grey-soft text-grey ring-grey-line" },
} as const;

export function ConfidenceChip({ c }: { c: Confidence }) {
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", CONF[c].cls)}>{CONF[c].label}</span>;
}

export function StatusIcon({ status }: { status: RuleStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green" aria-label="pass" />;
  if (status === "fail") return <OctagonX className="h-4 w-4 text-red" aria-label="fail" />;
  if (status === "na") return <MinusCircle className="h-4 w-4 text-ink-3" aria-label="not applicable" />;
  return <CircleDashed className="h-4 w-4 text-grey" aria-label="cannot check" />;
}

export const STATUS_LABEL: Record<RuleStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  na: "Not applicable",
  "cannot-check": "Can't check yet",
};

export function SourceBadge({ source }: { source: FieldSource }) {
  if (source === "uploaded") return null;
  const map: Record<FieldSource, string> = {
    uploaded: "",
    chat: "from chat",
    calculated: "calculated",
    edited: "edited",
    generated: "auto",
  };
  const cls = source === "edited" ? "bg-amber-soft text-amber" : source === "calculated" ? "bg-brand-soft text-brand" : "bg-grey-soft text-ink-3";
  return <span className={cx("ml-1 rounded px-1 py-px text-[10px] font-medium", cls)}>{map[source]}</span>;
}

export function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("print-break rounded-2xl bg-panel ring-1 ring-line shadow-[0_1px_2px_rgba(15,27,45,0.04),0_8px_24px_-12px_rgba(15,27,45,0.10)]", className)}>
      {children}
    </section>
  );
}

export function CardHead({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-5 pb-2 pt-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-ink-3">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-strong shadow-sm shadow-brand/20",
    secondary: "bg-white text-ink ring-1 ring-inset ring-grey-line hover:bg-grey-soft",
    ghost: "text-ink-2 hover:bg-grey-soft",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", v, s, className)}
    >
      {children}
    </button>
  );
}
