export function HazardIcon({ type, size = 16 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }

  switch (type) {
    case 'fire':
      return (
        <svg {...props}>
          <path d="M12 2c.5 4.2-3 6.2-3 10a5 5 0 0 0 10 0c0-2.7-1.4-5.1-3.3-7-.3 1.7-1.2 2.7-2.2 3C13.8 5.9 13.5 3.6 12 2Z" />
          <path d="M10.5 14.5a2.5 2.5 0 0 0 5 0c0-1.1-.6-2.1-1.5-2.8-.2.9-.7 1.4-1.3 1.6-.6-.6-.9-1.5-.8-2.3-.9.9-1.4 2.1-1.4 3.5Z" />
        </svg>
      )
    case 'collapse':
      return (
        <svg {...props}>
          <path d="M3 20h18" />
          <path d="M5 20V8l5-3v7l4-2 5 4v6" />
          <path d="m11 11 2 3-2 3" />
        </svg>
      )
    case 'flood':
      return (
        <svg {...props}>
          <path d="M2 15c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
          <path d="M2 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
          <path d="M12 3v7" />
          <path d="m9 7 3 3 3-3" />
        </svg>
      )
    case 'medical':
    default:
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      )
  }
}
