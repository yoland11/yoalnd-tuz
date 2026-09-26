// Lightweight, dependency-free graduation gown preview. Renders a stylised
// mortarboard + gown + stole so a color palette can be previewed on an actual
// figure (not just swatches). Pure presentational SVG — no data, no network.

type RobeColors = {
  robe?: string;
  sash?: string;
  cap?: string;
  tassel?: string;
  embroidery?: string;
};

function pick(value: string | undefined, fallback: string): string {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : fallback;
}

export function GraduationRobePreview({
  colors,
  className,
  size = 120,
}: {
  colors: RobeColors;
  className?: string;
  size?: number;
}) {
  const robe = pick(colors.robe, "#111111");
  const sash = pick(colors.sash, "#D4B15A");
  const cap = pick(colors.cap, robe);
  const tassel = pick(colors.tassel, sash);
  const embroidery = pick(colors.embroidery, sash);

  return (
    <svg
      viewBox="0 0 120 160"
      width={size}
      height={(size * 160) / 120}
      className={className}
      role="img"
      aria-label="معاينة ألوان روب التخرج"
    >
      {/* Gown body */}
      <path
        d="M32 66 L88 66 L104 152 L16 152 Z"
        fill={robe}
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="1"
      />
      {/* Neck opening */}
      <path d="M52 66 L68 66 L60 82 Z" fill="rgba(255,255,255,0.14)" />
      {/* Stole / sash — two front strips */}
      <path d="M52 66 L57 66 L52 150 L46 150 Z" fill={sash} />
      <path d="M63 66 L68 66 L74 150 L68 150 Z" fill={sash} />
      {/* Embroidery trim on the stole ends */}
      <rect x="45" y="144" width="8" height="6" fill={embroidery} />
      <rect x="67" y="144" width="8" height="6" fill={embroidery} />
      {/* Head */}
      <circle cx="60" cy="40" r="13" fill="#E8C9A6" />
      {/* Mortarboard band */}
      <path d="M47 30 L73 30 L71 40 L49 40 Z" fill={cap} />
      {/* Mortarboard top */}
      <path
        d="M60 16 L94 28 L60 40 L26 28 Z"
        fill={cap}
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="1"
      />
      {/* Button + tassel */}
      <circle cx="60" cy="28" r="2.4" fill={tassel} />
      <path
        d="M60 28 L84 28 L84 50"
        fill="none"
        stroke={tassel}
        strokeWidth="1.6"
      />
      <path d="M81 50 L87 50 L85.5 60 L82.5 60 Z" fill={tassel} />
    </svg>
  );
}
