/** Decorative botanical SVGs (purely visual, aria-hidden). */

export function Sprig({ className = "", flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 120 60" className={className} aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <g fill="none" stroke="#b8935a" strokeWidth="1.1" strokeLinecap="round">
        <path d="M4 52 C 30 46, 62 36, 116 8" />
        <path d="M30 45 C 26 36, 30 30, 36 27" />
        <path d="M58 36 C 56 27, 60 21, 66 19" />
      </g>
      <g fill="#e7c3cb" stroke="#c98d9b" strokeWidth=".8">
        <ellipse cx="20" cy="44" rx="7" ry="3" transform="rotate(-30 20 44)" />
        <ellipse cx="44" cy="40" rx="7" ry="3" transform="rotate(20 44 40)" />
        <ellipse cx="74" cy="28" rx="7" ry="3" transform="rotate(-35 74 28)" />
        <ellipse cx="92" cy="22" rx="6.5" ry="2.8" transform="rotate(15 92 22)" />
      </g>
      <g fill="#cfdccb" stroke="#8fab8f" strokeWidth=".8">
        <ellipse cx="34" cy="30" rx="5.5" ry="2.5" transform="rotate(-60 34 30)" />
        <ellipse cx="64" cy="22" rx="5.5" ry="2.5" transform="rotate(-55 64 22)" />
        <ellipse cx="106" cy="14" rx="5" ry="2.3" transform="rotate(-25 106 14)" />
      </g>
      <circle cx="116" cy="8" r="3.2" fill="#f2d3da" stroke="#c98d9b" strokeWidth=".8" />
    </svg>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden>
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-gold/70 sm:w-24" />
      <svg viewBox="0 0 24 12" className="h-3 w-6">
        <path d="M12 1 L15 6 L12 11 L9 6 Z" fill="#f7eddd" stroke="#b8935a" strokeWidth=".9" />
        <circle cx="3" cy="6" r="1.2" fill="#b8935a" /><circle cx="21" cy="6" r="1.2" fill="#b8935a" />
      </svg>
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-gold/70 sm:w-24" />
    </div>
  );
}

export function Heart({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 22" className={className} aria-hidden>
      <path d="M12 21 C 5 15, 1 11.5, 1 7 A 5.5 5.5 0 0 1 12 4.5 A 5.5 5.5 0 0 1 23 7 C 23 11.5, 19 15, 12 21 Z" fill="currentColor" />
    </svg>
  );
}
