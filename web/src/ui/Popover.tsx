import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

interface PopoverProps {
  button: ReactNode;
  /** The panel's name, for screen readers. */
  label: string;
  className?: string;
  /** Which edge of the button the panel lines up with. */
  align?: 'start' | 'end';
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}

/**
 * A TopBar button with a panel under it, such as the Designs menu. The panel grows out of its
 * button and shrinks back into it: it stays mounted, inert while closed, so CSS can animate both
 * ways. A click outside or Esc closes it.
 */
export function Popover({ button, label, className = '', align = 'start', onOpen, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panel.current!.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current!.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();   // Esc closes the panel; it doesn't also deselect in the room
      setOpen(false);
      trigger.current!.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`popover-anchor ${className}`} ref={root}>
      <button
        ref={trigger}
        className="popover-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {button}
      </button>
      <div
        ref={panel}
        id={id}
        className={`popover ${align}`}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        data-open={open}
        inert={!open}
      >
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
