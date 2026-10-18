import type { ReactNode } from 'react';

// Small line icons for the TopBar and History, drawn on a 16-unit grid with one stroke width.

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
export const Cart = () => (
  <Icon>
    <path d="M1.5 2h2l1.6 8.2a1 1 0 0 0 1 .8h6.1a1 1 0 0 0 1-.8L14.5 5H4.3" />
    <circle cx="6.5" cy="13.5" r="1" />
    <circle cx="12" cy="13.5" r="1" />
  </Icon>
);
