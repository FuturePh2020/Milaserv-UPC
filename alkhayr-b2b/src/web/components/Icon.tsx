/** Inline SVG icons (no icon font, no remote assets). Decorative by default (aria-hidden). */
const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16l-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3L12 4zm0 6v4m0 3v.01',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 8v5m0-8v.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.4-2.6M12 20h.01M15.5 10.6A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8M11 6.1a15 15 0 0 1 11 3.4',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
  cart: 'M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 7H6.2M9 20h.01M17 20h.01',
  orders: 'M7 3h10l3 3v15H4V3h3zm2 7h6m-6 4h6m-6 4h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  logout: 'M15 4h4v16h-4M10 16l4-4-4-4M14 12H3',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zm0 0a3 3 0 0 0 5.3 1.9A3 3 0 0 0 12 12a3 3 0 0 0 2.7-1.1A3 3 0 0 0 20 9M10 20v-5h4v5',
  inventory: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.4M22 21a7 7 0 0 0-4-6.3',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v5l3 2',
  truck: 'M3 6h11v10H3zm11 4h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  x: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9 9l6 6m0-6l-6 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  chevron: 'M10 6l6 6-6 6',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8m0-4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16m0 4v-4h-4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  upload: 'M12 16V4m-5 5l5-5 5 5M4 16v4h16v-4',
  chart: 'M4 20V10m6 10V4m6 16v-7M2 20h20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.4h-4l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
  download: 'M12 4v12m-5-5l5 5 5-5M4 16v4h16v-4',
} as const;

export type IconName = keyof typeof PATHS;

/** Icons whose arrow follows reading direction; always mirrored in RTL. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set(['logout', 'chevron']);

/** `directional` icons (arrows/chevrons) are mirrored in RTL so they point in reading direction. */
export function Icon({ name, label, directional: forced = false }: { name: IconName; label?: string; directional?: boolean }) {
  const directional = forced || DIRECTIONAL.has(name);
  return (
    <svg
      className={`c-icon${directional ? ' c-icon--directional' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
