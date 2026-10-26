// Decorative UK → EU road motif for the landing page. Not tracking and not a
// map: five stages the checks map onto, drawn once with a short reveal.

const STAGES = ["UK collection", "Export customs", "Road transit", "EU import", "Warehouse"];

export function RouteMotif() {
  return (
    <div className="mx-auto w-full max-w-2xl" aria-hidden>
      <div className="relative grid grid-cols-5">
        <div
          className="route-line absolute left-[10%] right-[10%] top-[5px] h-px"
          style={{ background: "linear-gradient(90deg, rgba(15,23,42,0.25), rgba(29,78,216,0.55), rgba(15,23,42,0.25))" }}
        />
        {STAGES.map((s, i) => (
          <div key={s} className="route-node flex flex-col items-center gap-2" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <span className={`relative h-[11px] w-[11px] rounded-full border-2 bg-canvas ${i === 0 || i === 4 ? "border-brand" : "border-ink/30"}`} />
            <span className="text-center text-[10px] font-medium uppercase leading-tight tracking-wider text-ink-3 sm:text-[11px]">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
