import { type FormEvent, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { budgetInText } from '@shared/generate';
import type { Brief } from '@shared/types';
import { chooseSpeed, generate, useGenerate, warm } from '../state/generate';
import { saveNow } from '../state/history';
import { useEditor } from '../state/store';
import { DesignCards } from './DesignCards';
import { count } from './format';
import { Close, Sparkle } from './icons';
import './brief.css';

/** The style chips of the Brief (spec §13.1). */
const STYLES = ['Japandi', 'Minimal', 'Mid-century', 'Cozy', 'Industrial', 'Boho'];
/** The speeds the AI can design at: standard, for the least credit, or fast mode, quicker for several times the credit. */
const SPEEDS = [
  { fast: false, name: 'Standard', hint: 'About 15–25 s for the 3 Designs, for the least credit.' },
  { fast: true, name: 'Fast', hint: 'About twice as quick, for about 3 times the credit.' },
];
/** What a Brief can look like, shown in the empty field. */
const EXAMPLE = 'cozy Japandi, under $400, I need a reading corner';

/**
 * "Generate" in the TopBar, and the dialog it opens: the Brief, then Claude's 3 Designs as cards that
 * draw themselves as Claude makes them (spec §13.1). It can close while they do: the takes keep coming.
 */
export function BriefDialog() {
  const scanId = useEditor((s) => s.design!.scanId);
  const { designName, designEdits, hasOriginals } = useEditor(useShallow((s) => ({
    designName: s.design!.name, designEdits: s.design!.edits.length, hasOriginals: !!s.setup?.originals.length,
  })));
  // The Brief of this Scan the Mover last sent, if any: the takes on it, or the form again to change it.
  const sent = useGenerate(useShallow((s) => (s.scanId === scanId ? { status: s.status, brief: s.brief, error: s.error } : undefined)));
  const fast = useGenerate((s) => s.fast);
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
  // Where the takes start: the room as the open Design has it, or the Scan as it is. A Design with no Edits is the Scan as it is.
  const [start, setStart] = useState<'current' | 'empty'>(designEdits ? 'current' : 'empty');
  const fromCurrent = start === 'current' && designEdits > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const budgetUsd = budget ? Number(budget) : textBudget;
    const brief: Brief = { text: text.trim(), ...(styles.length && { styles }), ...(budgetUsd && { budgetUsd }) };
    if (!fromCurrent) return generate(scanId, brief);
    // The server reads the Design from its file: its latest change goes first. If that save fails, the last one saved stands.
    await saveNow().catch(() => {});
    void generate(scanId, brief, useEditor.getState().design!);
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
          <h2 id="brief-title">{step === 'brief' ? 'Generate 3 Designs with AI' : 'Three Designs for your Brief'}</h2>
          <button className="icon-button" aria-label="Close" onClick={() => dialog.current!.close()}><Close /></button>
        </header>
        {step !== 'brief' ? (
          <DesignCards onOpen={() => dialog.current!.close()} onBack={() => useGenerate.setState({ status: 'brief' })} />
        ) : (
          // Once the Mover starts writing a Brief, Claude's cache gets the room, so that the takes start sooner.
          <form onSubmit={(event) => void submit(event)} onInput={() => warm(scanId)}>
            <p className="muted">
              Say what you want, and the room will design itself for you.
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
            {/* Where the takes start, and how fast they come: side by side. */}
            <div className="field-row">
              <fieldset className="field start-from">
                <legend>Start from</legend>
                <div className="chips">
                  <button type="button" aria-pressed={fromCurrent} disabled={!designEdits} onClick={() => setStart('current')}>Current room</button>
                  <button type="button" aria-pressed={!fromCurrent} onClick={() => setStart('empty')}>{hasOriginals ? 'Room as scanned' : 'Empty room'}</button>
                </div>
                <span className="hint">
                  {!designEdits ? 'This Design has no Edits yet, so the AI starts from the room as it is.'
                    : fromCurrent ? `"${designName}" as it is now: the AI keeps its ${count(designEdits, 'Edit')} and designs around them. Its Pieces don't count toward the budget.`
                    : hasOriginals ? "The room as it was scanned, without this Design's Edits." : "The room with nothing in it: the AI furnishes it from scratch."}
                </span>
              </fieldset>
              <fieldset className="field speed">
                <legend>Speed</legend>
                <div className="chips">
                  {SPEEDS.map((speed) => (
                    <button
                      type="button"
                      key={speed.name}
                      aria-pressed={speed.fast === fast}
                      // Each speed runs on its own model, whose cache gets the room too.
                      onClick={() => { chooseSpeed(speed.fast); warm(scanId); }}
                    >
                      {speed.name}
                    </button>
                  ))}
                </div>
                <span className="hint">{SPEEDS.find((speed) => speed.fast === fast)!.hint}</span>
              </fieldset>
            </div>
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
            {sent?.error && <p className="error" role="alert">The AI couldn't make the Designs: {sent.error}</p>}
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

