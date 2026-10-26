// Decorative UK → EU road motif for the landing page. Not tracking and not a
// map: five stages the checks map onto, drawn once with a short reveal.

const STAGES = ["UK collection", "Export customs", "Road transit", "EU import", "Warehouse"];

export function RouteMotif() {
  return (
    <div className="mx-auto w-full max-w-2xl" aria-hidden>
      <div className="relative grid grid-cols-5">
        <div
          className="route-line absolute left-[10%] right-[10%] top-[5px] h-px"
          style={{ background: "linear-gradient(90deg, rgba(27,47,82,0.55), rgba(27,47,82,0.35) 55%, rgba(242,102,43,0.85))" }}
        />
        {STAGES.map((s, i) => (
          <div key={s} className="route-node flex flex-col items-center gap-2" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <span className={`relative h-[11px] w-[11px] rounded-full border-2 bg-canvas ${i === 0 ? "border-brand" : i === 4 ? "border-accent bg-accent" : "border-ink/30"}`} />
            <span className="text-center text-[10px] font-medium uppercase leading-tight tracking-wider text-ink-3 sm:text-[11px]">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
