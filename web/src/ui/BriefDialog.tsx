import { type FormEvent, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { budgetInText } from '@shared/generate';
import type { Brief } from '@shared/types';
import { generate, useGenerate, warm } from '../state/generate';
import { useEditor } from '../state/store';
import { DesignCards } from './DesignCards';
import { Close, Sparkle } from './icons';
import './brief.css';

/** The style chips of the Brief (spec §13.1). */
const STYLES = ['Japandi', 'Minimal', 'Mid-century', 'Cozy', 'Industrial', 'Boho'];
/** What a Brief can look like, shown in the empty field. */
const EXAMPLE = 'cozy Japandi, under $400, I need a reading corner';

/**
 * "Generate" in the TopBar, and the dialog it opens: the Brief, then Claude's 3 Designs as cards that
 * draw themselves as Claude makes them (spec §13.1). It can close while they do: the takes keep coming.
 */
export function BriefDialog() {
  const scanId = useEditor((s) => s.design!.scanId);
  // The Brief of this Scan the Mover last sent, if any: the takes on it, or the form again to change it.
  const sent = useGenerate(useShallow((s) => (s.scanId === scanId ? { status: s.status, brief: s.brief, error: s.error } : undefined)));
  const step = sent?.status ?? 'brief';
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(sent?.brief?.text ?? '');
  const [styles, setStyles] = useState<string[]>(sent?.brief?.styles ?? []);
  // A budget the Brief's words named stays in its words, so that changing them changes it.
  const [budget, setBudget] = useState(() => {
    const { text: sentText = '', budgetUsd } = sent?.brief ?? {};
    return budgetUsd && budgetUsd !== budgetInText(sentText) ? String(budgetUsd) : '';
  });
  const textBudget = budgetInText(text);

  function submit(event: FormEvent) {
    event.preventDefault();
    const budgetUsd = budget ? Number(budget) : textBudget;
    const brief: Brief = { text: text.trim(), ...(styles.length && { styles }), ...(budgetUsd && { budgetUsd }) };
    void generate(scanId, brief);
  }

  return (
    <>
      <button className="generate-button" onClick={() => dialog.current!.showModal()}>
        <Sparkle />
        {step === 'designing' ? 'Designing…' : 'Generate'}
      </button>
      <dialog
        ref={dialog}
        className="brief-dialog"
        aria-labelledby="brief-title"
        onClick={(event) => event.target === dialog.current && dialog.current.close()}
      >
        <header>
          <h2 id="brief-title">{step === 'brief' ? 'Ask Claude for 3 Designs' : 'Three Designs for your Brief'}</h2>
          <button className="icon-button" aria-label="Close" onClick={() => dialog.current!.close()}><Close /></button>
        </header>
        {step !== 'brief' ? (
          <DesignCards onOpen={() => dialog.current!.close()} onBack={() => useGenerate.setState({ status: 'brief' })} />
        ) : (
          // Once the Mover starts writing a Brief, Claude's cache gets the room, so that the takes start sooner.
          <form onSubmit={submit} onInput={() => warm(scanId)}>
            <p className="muted">
              Claude arranges real Catalog items in your Scan: art on the walls, a rug, lamps, plants and pillows, and paint.
              You get three takes: literal, bolder, and budget-conscious.
            </p>
            <label className="field">
              <span>What do you want?</span>
              <textarea
                name="brief"
                rows={3}
                placeholder={EXAMPLE}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.currentTarget.form!.requestSubmit()}
                autoFocus
              />
            </label>
            <fieldset className="field">
              <legend>Style</legend>
              <div className="chips">
                {STYLES.map((style) => (
                  <button
                    type="button"
                    key={style}
                    aria-pressed={styles.includes(style)}
                    onClick={() => setStyles((chosen) => (chosen.includes(style) ? chosen.filter((s) => s !== style) : [...chosen, style]))}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field budget">
              <span>Budget <span className="muted">(optional)</span></span>
              <span className="money">
                <span aria-hidden="true">$</span>
                <input
                  name="budget"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder={textBudget ? String(textBudget) : 'No limit'}
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </span>
              {!budget && textBudget && <span className="hint">From your Brief</span>}
            </label>
            {sent?.error && <p className="error" role="alert">Claude couldn't make the Designs: {sent.error}</p>}
            <footer>
              <button type="button" onClick={() => dialog.current!.close()}>Cancel</button>
              <button type="submit" className="primary" disabled={!text.trim()}>Generate 3 Designs</button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}

