// A fake Claude for tests: a real SDK client whose fetch answers each request of a generate loop from
// a script, so everything but the model runs for real.
import Anthropic from '@anthropic-ai/sdk';
import { DIRECTIONS, type Direction } from '../../shared/generate';

export interface FakeRequest { direction: Direction; body: Anthropic.Beta.MessageCreateParams; headers: Headers }
type ToolResult = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
/** One scripted reply: the content blocks Claude sends back, given the request it answers. */
export type Turn = (request: FakeRequest) => { content: unknown[]; stop_reason?: string } | 'error' | 'hang';

export const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

/** The tool results a request sends back for the last turn. */
export const results = ({ body }: FakeRequest) => body.messages.at(-1)!.content as ToolResult[];

/** A Claude that answers each loop's requests from its script, and the requests it got. */
export function fakeClaude(scripts: Partial<Record<Direction, Turn[]>>) {
  const requests: FakeRequest[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Anthropic.Beta.MessageCreateParams;
    const first = body.messages[0].content as string;
    const direction = DIRECTIONS.find((_, i) => first.includes(`Direction ${i + 1} of 3`))!;
    const request = { direction, body, headers: new Headers(init!.headers) };
    requests.push(request);
    const turn = scripts[direction]?.[body.messages.filter(({ role }) => role === 'assistant').length];
    const reply = turn?.(request) ?? { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
    if (reply === 'error') return Response.json({ type: 'error', error: { type: 'api_error', message: 'Overloaded' } }, { status: 500 });
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }
    return Response.json({
      id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: reply.content,
      stop_reason: reply.stop_reason ?? 'tool_use', stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
    });
  };
  return { client: new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }), requests };
}
