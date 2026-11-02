/**
 * The tools that act on the signed-in person's own account.
 *
 * Every one of them is a thin call to /api/mcp on cmein.com, carrying the caller's own access token.
 * Nothing is decided here: the credit check, the terms check, the refund cap and the scope rules all
 * live in the app, where they already applied to the same actions done by hand. This file's only job
 * is to turn a tool call into that request and the answer back into a sentence.
 *
 * It deliberately never asks for photographs. "What have I made" is answered with scenes and
 * statuses, not image URLs, because routing a customer's pictures through a third party's logs buys
 * nothing — the pictures are in the app, where they already are.
 */
import type { Caller } from './auth.js';

const ORIGIN = process.env.CMEIN_ORIGIN ?? 'https://cmein.com';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const text = (body: string, extra?: Partial<ToolResult>): ToolResult => ({
  content: [{ type: 'text', text: body }],
  ...extra,
});

/** Which scope each tool needs, checked here so a missing one is a sentence rather than a 403. */
export const SCOPES = {
  my_credits: 'credits:read',
  my_generations: 'photos:read',
  find_scene: 'scenes:read',
  request_credits_back: 'support:write',
} as const;

export type AuthedTool = keyof typeof SCOPES;
export const AUTHED_TOOLS = Object.keys(SCOPES) as AuthedTool[];

async function call(caller: Caller, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${ORIGIN}/api/mcp${path}`, {
    method,
    headers: {
      authorization: `Bearer ${caller.token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const why = (parsed as any)?.message ?? (parsed as any)?.error ?? `the server answered ${res.status}`;
    throw new Error(String(why));
  }
  return parsed as any;
}

/** A refusal a person can act on, rather than a permission error they cannot. */
function missingScope(tool: AuthedTool): ToolResult {
  return text(
    `This needs the "${SCOPES[tool]}" permission, which was not granted when CMeIn was connected. ` +
      'Reconnect CMeIn and approve it to use this.',
    { isError: true },
  );
}

export async function run(tool: AuthedTool, caller: Caller, args: any): Promise<ToolResult> {
  if (!caller.scopes.has(SCOPES[tool])) return missingScope(tool);

  try {
    switch (tool) {
      case 'my_credits': {
        const r = await call(caller, 'GET', '/credits');
        // Every figure here comes from the server. The price per photo used to be written into this
        // sentence as 300, which would have kept saying 300 after the price moved.
        const credits = Number(r.credits ?? 0);
        const per = Number(r.creditsPerPhoto ?? 0);
        const photos = Number(r.photosRemaining ?? 0);
        const parts = [
          `${credits.toLocaleString('en-US')} credits` +
            (r.approxUsd ? ` (about $${Number(r.approxUsd).toFixed(2)})` : '') +
            (per ? ` — ${photos} more photo${photos === 1 ? '' : 's'} at ${per} credits each.` : '.'),
        ];
        if (Number(r.photoOnlyCredits ?? 0) > 0) {
          parts.push(
            `${Number(r.photoOnlyCredits).toLocaleString('en-US')} of those can only be spent on ` +
              'generating photos, not on anything else.',
          );
        }
        if (r.spentAllTime) {
          parts.push(`Spent all time: ${Number(r.spentAllTime).toLocaleString('en-US')}.`);
        }
        return text(parts.join(' '), { structuredContent: r });
      }

      case 'my_generations': {
        const limit = Math.max(1, Math.min(Number(args?.limit ?? 10), 25));
        const r: any[] = await call(caller, 'GET', `/generations?limit=${limit}`);
        if (!r.length) return text('Nothing generated yet on this account.', { structuredContent: { generations: [] } });
        const lines = r.map(g =>
          `- ${g.scene ?? 'a scene'} — ${String(g.status ?? '').toLowerCase()}` +
          (g.createdAt ? ` (${String(g.createdAt).slice(0, 10)})` : ''));
        return text(
          `${r.length} most recent:\n${lines.join('\n')}\n\nThe photos themselves are in the app: ${ORIGIN}`,
          { structuredContent: { generations: r } },
        );
      }

      case 'find_scene': {
        const q = String(args?.q ?? '').trim();
        const limit = Math.max(1, Math.min(Number(args?.limit ?? 12), 40));
        const r: any[] = await call(caller, 'GET', `/scenes?q=${encodeURIComponent(q)}&limit=${limit}`);
        if (!r.length) {
          return text(`No scene matches "${q}". Try a plainer word — a place, an activity, a setting.`,
            { structuredContent: { scenes: [] } });
        }
        return text(
          r.map(s => `- ${s.scene}${s.category ? ` (${String(s.category).toLowerCase().replace(/_/g, ' ')})` : ''}`).join('\n'),
          { structuredContent: { scenes: r } },
        );
      }

      case 'request_credits_back': {
        const reason = String(args?.reason ?? '').trim();
        if (reason.length < 10) {
          return text('Say what went wrong with the photo, in a sentence or two — that is what a person reads.',
            { isError: true });
        }
        const r = await call(caller, 'POST', '/credits-back', {
          reason,
          batchId: args?.generationId ?? null,
        });
        return text(String(r.message ?? 'Your request reached CMeIn.'), { structuredContent: r });
      }
    }
  } catch (e: any) {
    // The app's own refusals say something useful — "not enough credits", "you have reached the
    // cap" — and repeating them verbatim is more use than a generic failure.
    return text(`That did not go through: ${e?.message ?? e}`, { isError: true });
  }
}
