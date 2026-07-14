"use client";

type Option = { value: number; label: string };

/**
 * Sélecteur segmenté avec indicateur glissant.
 * Utilisé pour choisir le nombre de jours affichés (1 / 3 / 7).
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option[];
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const width = 100 / options.length;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex rounded-xl border border-line bg-white/[0.06] p-1 shadow-soft backdrop-blur-md"
    >
      {/* Indicateur glissant */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 rounded-lg bg-brand-gradient shadow-glow-sm transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{
          width: `calc(${width}% - 0.25rem)`,
          transform: `translateX(calc(${index * 100}% + ${index * 0.25}rem))`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative z-10 flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors duration-200 ${
              active ? "text-brand-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
