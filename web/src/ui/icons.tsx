import type { ReactNode } from 'react';

// Small line icons, drawn on a 16-unit grid with one stroke width (docs/design/sketch-style.md). No emoji.

const Icon = ({ children }: { children: ReactNode }) => (
  <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const ChevronDown = () => <Icon><path d="m4 6 4 4 4-4" /></Icon>;
export const Check = () => <Icon><path d="m3.5 8.5 3 3 6-7" /></Icon>;
export const Close = () => <Icon><path d="m4.5 4.5 7 7m0-7-7 7" /></Icon>;
export const Undo = () => <Icon><path d="M6 3.5 2.5 7 6 10.5" /><path d="M2.5 7h7a4 4 0 0 1 0 8h-2" /></Icon>;
export const Redo = () => <Icon><path d="M10 3.5 13.5 7 10 10.5" /><path d="M13.5 7h-7a4 4 0 0 0 0 8h2" /></Icon>;
export const ArrowRight = () => <Icon><path d="M3 8h10M9 4l4 4-4 4" /></Icon>;
export const ArrowLeft = () => <Icon><path d="M13 8H3m4-4L3 8l4 4" /></Icon>;
export const Import = () => <Icon><path d="M8 2.5v7.5M5 7l3 3 3-3" /><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" /></Icon>;
export const Plus = () => <Icon><path d="M8 3.5v9M3.5 8h9" /></Icon>;
export const RotateLeft = () => <Icon><path d="M3 3.5v3h3" /><path d="M3.4 6.5A5 5 0 1 1 3 9.5" /></Icon>;
export const RotateRight = () => <Icon><path d="M13 3.5v3h-3" /><path d="M12.6 6.5A5 5 0 1 0 13 9.5" /></Icon>;
export const Lock = () => <Icon><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></Icon>;
export const Unlock = () => <Icon><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" /></Icon>;
export const Pencil = () => <Icon><path d="m10.5 3 2.5 2.5-7.5 7.5H3v-2.5z" /><path d="m9 4.5 2.5 2.5" /></Icon>;
export const Bookmark = () => <Icon><path d="M4.5 2.5h7v11L8 10.5l-3.5 3z" /></Icon>;
export const Sparkle = () => <Icon><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" /></Icon>;
export const Cart = () => (
  <Icon>
    <path d="M1.5 2h2l1.6 8.2a1 1 0 0 0 1 .8h6.1a1 1 0 0 0 1-.8L14.5 5H4.3" />
    <circle cx="6.5" cy="13.5" r="1" />
    <circle cx="12" cy="13.5" r="1" />
  </Icon>
);
