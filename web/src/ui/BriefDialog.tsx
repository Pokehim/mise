import { type FormEvent, useEffect, useRef, useState } from 'react';
import { budgetInText, DIRECTIONS, type GenerateResult } from '@shared/generate';
import type { Brief } from '@shared/types';
import { useEditor } from '../state/store';
import { DesignCards, DIRECTION_NAMES } from './DesignCards';
import { Close, Sparkle } from './icons';
import './brief.css';

/** The style chips of the Brief (spec §13.1). */
const STYLES = ['Japandi', 'Minimal', 'Mid-century', 'Cozy', 'Industrial', 'Boho'];
/** What a Brief can look like, shown in the empty field. */
const EXAMPLE = 'cozy Japandi, under $400, I need a reading corner';

/** Asks the server for 3 Designs (spec §13.1). It answers once every loop has finished or failed. */
async function generate(scanId: string, brief: Brief): Promise<GenerateResult> {
  const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanId, brief }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}`);
  return body;
}

type Step = { step: 'brief'; error?: string } | { step: 'working'; since: number } | { step: 'done'; result: GenerateResult };

/** "Generate" in the TopBar, and the dialog it opens: the Brief, then Claude's 3 Designs as cards (spec §13.1). */
export function BriefDialog() {
  const scanId = useEditor((s) => s.design!.scanId);
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [styles, setStyles] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const [step, setStep] = useState<Step>({ step: 'brief' });
  const working = step.step === 'working';
  const textBudget = budgetInText(text);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const budgetUsd = budget ? Number(budget) : textBudget;
    const brief: Brief = { text: text.trim(), ...(styles.length && { styles }), ...(budgetUsd && { budgetUsd }) };
    setStep({ step: 'working', since: Date.now() });
    try {
      setStep({ step: 'done', result: await generate(scanId, brief) });
    } catch (err) {
      setStep({ step: 'brief', error: (err as Error).message });
    }
  }

  return (
    <>
      <button className="generate-button" onClick={() => dialog.current!.showModal()}>
        <Sparkle />
        {working ? 'Designing…' : 'Generate'}
      </button>
      <dialog
        ref={dialog}
        className="brief-dialog"
        aria-labelledby="brief-title"
        // Esc closes it, but not mid-request: the Designs would arrive with nowhere to show.
        onCancel={(event) => working && event.preventDefault()}
        onClick={(event) => event.target === dialog.current && !working && dialog.current.close()}
      >
        <header>
          <h2 id="brief-title">{step.step === 'done' ? 'Three Designs for your Brief' : 'Ask Claude for 3 Designs'}</h2>
          <button className="icon-button" aria-label="Close" disabled={working} onClick={() => dialog.current!.close()}><Close /></button>
        </header>
        {step.step === 'done' ? (
          <DesignCards result={step.result} onOpen={() => dialog.current!.close()} onBack={() => setStep({ step: 'brief' })} />
        ) : (
          <form onSubmit={submit}>
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
                disabled={working}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.currentTarget.form!.requestSubmit()}
                autoFocus
              />
            </label>
            <fieldset className="field" disabled={working}>
              <legend>Style</legend>
              <div className="chips">
                {STYLES.map((style) => (
                  <button
                    type="button"
                    key={style}
                    aria-pressed={styles.includes(style)}
                    onClick={() => setStyles(styles.includes(style) ? styles.filter((s) => s !== style) : [...styles, style])}
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
                  disabled={working}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </span>
              {!budget && textBudget && <span className="hint">From your Brief</span>}
            </label>
            {step.step === 'brief' && step.error && <p className="error" role="alert">Claude couldn't make the Designs: {step.error}</p>}
            {working ? <Working since={step.since} /> : (
              <footer>
                <button type="button" onClick={() => dialog.current!.close()}>Cancel</button>
                <button type="submit" className="primary" disabled={!text.trim()}>Generate 3 Designs</button>
              </footer>
            )}
          </form>
        )}
      </dialog>
    </>
  );
}

/** While Claude designs: one placeholder per direction, and the seconds so far. */
function Working({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="working" role="status">
      <ul className="design-cards placeholders" aria-hidden="true">
        {DIRECTIONS.map((direction) => (
          <li key={direction}><span className="direction">{DIRECTION_NAMES[direction]}</span><span className="stroke" /><span className="stroke short" /></li>
        ))}
      </ul>
      <p>Claude is decorating three takes on your Brief… <span className="muted">{Math.round((now - since) / 1000)} s</span></p>
    </div>
  );
}
