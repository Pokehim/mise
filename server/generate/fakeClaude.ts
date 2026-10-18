// A fake Claude for tests: a real SDK client whose fetch answers each request of a generate loop from
// a script, so everything but the model runs for real, the streaming Tool Runner included.
import Anthropic from '@anthropic-ai/sdk';
import { DIRECTIONS, type Direction } from '../../shared/generate';

export interface FakeRequest { direction?: Direction; body: Anthropic.Beta.MessageCreateParams; headers: Headers }
type ToolResult = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
/** One scripted reply: the content blocks Claude sends back, given the request it answers. */
export type Turn = (request: FakeRequest) => { content: unknown[]; stop_reason?: string } | 'error' | 'rate-limited' | 'hang';

export const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

/** The tool results a request sends back for the last turn. */
export const results = ({ body }: FakeRequest) => body.messages.at(-1)!.content as ToolResult[];

const USAGE = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };

/**
 * A Claude that answers each loop's requests from its script, keyed by the direction its first message
 * names, and the requests it got. A warm-up (max_tokens 0) gets an empty reply.
 */
export function fakeClaude(scripts: Partial<Record<Direction, Turn[]>>) {
  const requests: FakeRequest[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Anthropic.Beta.MessageCreateParams;
    const first = body.messages[0].content as string;
    const direction = DIRECTIONS.find((_, i) => first.includes(`Direction ${i + 1} of 3`));
    const request = { direction, body, headers: new Headers(init!.headers) };
    requests.push(request);
    if (body.max_tokens === 0) return reply(body, { content: [], stop_reason: 'max_tokens' }, requests.length);
    const turn = direction && scripts[direction]?.[body.messages.filter(({ role }) => role === 'assistant').length];
    const scripted = turn?.(request) ?? { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
    if (scripted === 'error') return Response.json({ type: 'error', error: { type: 'api_error', message: 'Overloaded' } }, { status: 500 });
    if (scripted === 'rate-limited') return Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'Fast mode is busy' } }, { status: 429 });
    if (scripted === 'hang') {
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }
    return reply(body, scripted, requests.length);
  };
  return { client: new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }), requests };
}

/** The reply to a request: one JSON message, or for a streamed request, the same message as server-sent events. */
function reply(body: Anthropic.Beta.MessageCreateParams, { content, stop_reason = 'tool_use' }: { content: unknown[]; stop_reason?: string }, n: number) {
  const message = { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null, usage: USAGE };
  if (!body.stream) return Response.json(message);
  const blocks = content as ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown })[];
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...USAGE, output_tokens: 0 } } },
    ...blocks.flatMap((block, index) => [
      { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } },
      {
        type: 'content_block_delta', index,
        delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } },
    { type: 'message_stop' },
  ];
  const sse = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
}
