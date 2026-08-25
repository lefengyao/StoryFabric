/** 织章 · StoryFabric 品牌图标（与 resources/icon.svg 同源） */
export function AppLogo({ size = 36, className }: { size?: number; className?: string }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="织章 StoryFabric"
    >
      <defs>
        <linearGradient id="applogo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id="applogo-ribbon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fcd34d" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#applogo-bg)" />
      <path d="M300 80 H344 V188 H300 Z" fill="url(#applogo-ribbon)" />
      <path d="M300 336 H344 V436 L322 410 L300 436 Z" fill="url(#applogo-ribbon)" />
      <path d="M84 206 C142 174 204 170 250 194 L250 372 C204 350 142 354 84 384 Z" fill="#ffffff" />
      <path d="M428 206 C370 174 308 170 262 194 L262 372 C308 350 370 354 428 384 Z" fill="#ffffff" />
      <g stroke="#a5b4fc" strokeWidth="13" strokeLinecap="round">
        <path d="M232 240 L280 258" />
        <path d="M232 296 L280 314" />
        <path d="M232 352 L280 370" />
      </g>
    </svg>
  )
}
