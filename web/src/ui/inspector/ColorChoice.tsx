import { useEffect, useEffectEvent, useRef } from 'react';
import { COLOR_NAMES } from '@shared/describe';
import type { Hex } from '@shared/types';

/**
 * The 12 curated swatches of Recolor and Paint (spec §10.4): wall paints first, then furniture
 * colors. Taken from the names History uses, so a swatch reads the same there.
 */
const SWATCHES = [
  'Warm White', 'Greige', 'Sage', 'Blush', 'Terracotta', 'Mustard',
  'Powder Blue', 'Navy', 'Green', 'Tan', 'Walnut', 'Black',
].map((name) => COLOR_NAMES.find((entry) => entry[0] === name)!);

interface ColorChoiceProps {
  /** The color chosen now, or null for the scanned or modeled look. */
  value: Hex | null;
  onChoose: (color: Hex | null) => void;
  resetLabel: string;
  /** Whether there is a color to reset; by default, when there is a value. */
  resettable?: boolean;
}

/** A swatch, a color picker, or a reset: each choice is one Edit. */
export function ColorChoice({ value, onChoose, resetLabel, resettable = value !== null }: ColorChoiceProps) {
  const picker = useRef<HTMLInputElement>(null!);
  // The picker's change event fires once, when a color is picked; React's onChange fires on every
  // move of the picker, which would make an Edit for each.
  const onPick = useEffectEvent(() => onChoose(picker.current.value as Hex));
  useEffect(() => {
    const input = picker.current;
    input.addEventListener('change', onPick);
    return () => input.removeEventListener('change', onPick);
  }, []);
  useEffect(() => {
    picker.current.value = value ?? '#ffffff';   // also after an Edit made elsewhere, such as an undo
  }, [value]);

  return (
    <div className="color-choice">
      <div className="swatches">
        {SWATCHES.map(([name, color]) => (
          <button
            key={color}
            className="swatch"
            title={name}
            aria-label={name}
            aria-pressed={value === color}
            style={{ background: color }}
            onClick={() => onChoose(color)}
          />
        ))}
      </div>
      <div className="actions">
        <label className="picker">
          <input ref={picker} type="color" />
          Other color…
        </label>
        <button disabled={!resettable} onClick={() => onChoose(null)}>{resetLabel}</button>
      </div>
    </div>
  );
}
