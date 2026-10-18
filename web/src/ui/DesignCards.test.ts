import { describe, expect, it } from 'vitest';
import { planLines } from './DesignCards';

describe('planLines', () => {
  it("keeps the plan's latest lines, without Markdown's bold and bullet marks or empty lines", () => {
    const plan = '**Concept:** Minimal.\n\n**Layout:**\n\n- The bed by the window.\n* A desk.\n\n- A rug.\n- A lamp.\n- A plant.\n';

    expect(planLines(plan)).toEqual(['Layout:', 'The bed by the window.', 'A desk.', 'A rug.', 'A lamp.', 'A plant.']);
  });
});
