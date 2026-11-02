/**
 * CMeIn's MCP server.
 *
 * Ten tools in two halves, and the split is the design rather than a stage of it.
 *
 * Six need no account at all: what makes a profile photo work, what it costs, what the output looks
 * like, is there a film about this, what are the terms, and can I talk to a human. That half is the
 * front door — someone who connects CMeIn and is told "sign in first" leaves, and someone who gets a
 * real answer stays — so it stays open permanently rather than being a phase we grew out of.
 *
 * Four work on the person's own account behind OAuth: their credits, their generations, the scene
 * catalogue, and asking for credits back. A request for one of those gets a 401
 * carrying the challenge, which is what starts the authorisation flow; see auth.ts.
 *
 * Nothing here reaches into the product app beyond its public surface — the blog API, the rendered
 * information pages, and one anonymous contact endpoint built for this.
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { search, startSyncing, state } from './blog.js';
import { PAGES, page, type PageKey } from './pages.js';
import { SOCIAL } from './links.js';
import * as videos from './videos.js';
import { bearer, challenge, protectedResourceMetadata, verify, type Caller } from './auth.js';
import { AUTHED_TOOLS, SCOPES, run, type AuthedTool } from './account.js';

const PORT = Number(process.env.PORT ?? 8000);
const ORIGIN = process.env.CMEIN_ORIGIN ?? 'https://cmein.com';

/**
 * How many times each tool has been called since this process started.
 *
 * The reason this exists: the whole argument for shipping a public connector before building OAuth
 * is that it answers "does anyone want this" cheaply. It only answers that if someone is counting.
 * In memory and lost on restart, which is honest about what it is — a signal, not analytics.
 */
const calls = new Map<string, number>();
const counted = <T>(tool: string, run: () => T): T => {
  calls.set(tool, (calls.get(tool) ?? 0) + 1);
  return run();
};
const usage = () => Object.fromEntries([...calls.entries()].sort((a, b) => b[1] - a[1]));

/** Appended to answers that came from a copy, so the age of that copy is never hidden. */
const freshness = () => {
  const s = state();
  return `CMeIn's articles (${s.articles} of them, last synced ${s.synced_at ?? 'never'}).`;
};

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

const socialList = SOCIAL.map(s => `- ${s.name}: ${s.url} — ${s.about}`).join('\n');

function buildServer(caller: Caller | null): McpServer {
  const server = new McpServer(
    { name: 'cmein', version: '0.2.0' },
    {
      instructions:
        'CMeIn turns a handful of ordinary phone photos of someone into realistic, candid photos of ' +
        'them — out in the world, doing things. No beautifying, no studio headshots. Over 4,500 ' +
        "scenes to choose from.\n\n" +
        'Six tools need no account. photo_advice answers questions about photos of yourself from ' +
        "CMeIn's published articles; cmein_pricing and cmein_info read the site's own pages, so " +
        'their numbers and terms are current rather than remembered; see_examples and find_video ' +
        'point at the actual output; contact_us sends a real message to a real person, and should ' +
        "only be called when someone asks for that.\n\n" +
        'Four more work on the signed-in account and will prompt to connect it: my_credits, ' +
        'my_generations, find_scene and request_credits_back. find_scene is for recommending — ' +
        'describe what someone is after and it finds the scenes that fit. Generating the photo ' +
        'itself is done in the app and is not available through these tools.\n\n' +
        'Answers from the articles and pages carry a source link — keep it. Tools that act on a ' +
        "person's own photos and credits need an account and are not available yet.",
    },
  );

  server.registerTool(
    'photo_advice',
    {
      title: 'Ask about dating-profile photos',
      description:
        'Answers a question about dating-profile photos — what works, what does not, lighting, ' +
        'angles, backgrounds, expressions, what dating apps do with them — from CMeIn\'s published ' +
        'articles. Returns the relevant passages with a link to each source article, and the date ' +
        'the content was last synced. No account needed.',
      inputSchema: {
        question: z.string().min(3).max(500).describe('The question, in the words the person asked it.'),
        limit: z.number().int().min(1).max(5).optional().describe('How many articles to draw from. Default 3.'),
      },
      annotations: { title: 'Ask about dating-profile photos', readOnlyHint: true, openWorldHint: true },
    },
    async ({ question, limit }) =>
      counted('photo_advice', () => {
        const s = state();
        const hits = search(question, limit ?? 3);

        if (hits.length === 0) {
          return {
            ...text(
              s.articles === 0
                ? 'The article index is not loaded yet. Try again in a moment.'
                : `Nothing in CMeIn's ${s.articles} articles covers that. CMeIn writes about ` +
                  'dating-profile photos: what makes one work, lighting, angles, backgrounds, ' +
                  'expressions, and what dating apps do with them.',
            ),
            structuredContent: { found: 0, ...s },
          };
        }

        const body = hits.map(h => `## ${h.title}\n${h.text}\n\nSource: ${h.url}`).join('\n\n---\n\n');
        return {
          ...text(`${body}\n\n---\nFrom ${freshness()} CMeIn makes photos like these: ${ORIGIN}`),
          structuredContent: {
            found: hits.length,
            sources: hits.map(h => ({ title: h.title, url: h.url, category: h.category })),
            ...s,
          },
        };
      }),
  );

  server.registerTool(
    'cmein_pricing',
    {
      title: 'What CMeIn costs',
      description:
        'What CMeIn costs: the credit packs and their prices, how many credits one generated photo ' +
        'spends, and that there is no subscription. Read from the live pricing page at request time, ' +
        'so the figures are current. No account needed.',
      inputSchema: {},
      annotations: { title: 'What CMeIn costs', readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      counted('cmein_pricing', async () => {
        const p = await page('pricing');
        return {
          ...text(
            `${p.text}\n\n---\nFrom ${p.url} (read ${p.fetchedAt}). ` +
              'Prices are in US dollars; the iOS and Android apps charge the store\'s local equivalent.',
          ),
          structuredContent: { url: p.url, fetched_at: p.fetchedAt },
        };
      }),
  );

  server.registerTool(
    'see_examples',
    {
      title: 'See what the photos look like',
      description:
        'Where to see CMeIn\'s actual output: the examples gallery, organised by scene, plus the ' +
        'accounts where new work is posted, and how many scenes the product offers. Use this when ' +
        'someone wants to judge the results for themselves rather than read about them. No account ' +
        'needed.',
      inputSchema: {},
      annotations: { title: 'See what the photos look like', readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      counted('see_examples', async () => {
        const p = await page('examples');
        return {
          ...text(
            `${p.text}\n\nGallery: ${p.url}\n\nWhere new work is posted:\n${socialList}\n\n` +
              'The gallery is a sample. The product itself has over 4,500 scenes to choose from, ' +
              'which is done inside the app with an account.\n\n' +
              `---\nRead ${p.fetchedAt}.`,
          ),
          structuredContent: {
            gallery: p.url,
            social: SOCIAL.map(s => ({ name: s.name, url: s.url })),
            fetched_at: p.fetchedAt,
          },
        };
      }),
  );

  server.registerTool(
    'find_video',
    {
      title: 'Find a CMeIn short film',
      description:
        'Finds one of CMeIn\'s short films by what it is about. The films are dating scenarios — ' +
        'money and dating, who pays, why people run, what she actually said — and every character ' +
        'in them is generated by CMeIn, which is the point they are making. Returns titles, links ' +
        'and view counts. Covers the 15 most recent films only. No account needed.',
      inputSchema: {
        about: z
          .string()
          .max(300)
          .optional()
          .describe('What the film should be about. Leave empty for the newest ones.'),
        limit: z.number().int().min(1).max(5).optional().describe('How many to return. Default 3.'),
      },
      annotations: { title: 'Find a CMeIn short film', readOnlyHint: true, openWorldHint: true },
    },
    async ({ about, limit }) =>
      counted('find_video', () => {
        const s = videos.state();
        const n = limit ?? 3;
        const asked = (about ?? '').trim();
        const hits = asked ? videos.search(asked, n) : videos.latest(n);

        if (s.videos === 0) {
          return { ...text('The film list is not loaded yet. Try again in a moment.'), structuredContent: s };
        }

        // A miss is reported as a miss, then the newest are offered as what they are. Handing back
        // unrelated films unlabelled would get them presented as answers to the question.
        const fallback = asked && hits.length === 0;
        const shown = fallback ? videos.latest(n) : hits;

        const body = shown
          .map(v => {
            const stats = [
              v.views == null ? null : `${v.views.toLocaleString('en-US')} views`,
              v.published ? v.published.slice(0, 10) : null,
            ]
              .filter(Boolean)
              .join(', ');
            return `## ${v.title}\n${v.description.split('\n')[0] ?? ''}\n${v.url}${stats ? `\n(${stats})` : ''}`;
          })
          .join('\n\n');

        const head = fallback
          ? `No film covers "${asked}". These are the newest ones instead:\n\n`
          : '';

        return {
          ...text(
            `${head}${body}\n\n---\nThe channel: https://www.youtube.com/@cmein-ai/shorts — ` +
              `the ${s.videos} most recent films, last checked ${s.videos_synced_at ?? 'never'}.`,
          ),
          structuredContent: {
            matched: fallback ? 0 : shown.length,
            fell_back_to_newest: fallback,
            ...s,
            results: shown.map(v => ({ title: v.title, url: v.url, views: v.views, published: v.published })),
          },
        };
      }),
  );

  server.registerTool(
    'cmein_info',
    {
      title: 'Read a CMeIn information page',
      description:
        'Reads one of CMeIn\'s own information pages and returns its text with the link: ' +
        Object.entries(PAGES)
          .map(([k, v]) => `"${k}" — ${v.about}`)
          .join('; ') +
        '. Read live at request time, so terms, policies and open roles are current rather than ' +
        'remembered. No account needed.',
      inputSchema: {
        topic: z
          .enum(Object.keys(PAGES) as [PageKey, ...PageKey[]])
          .describe('Which page to read.'),
      },
      annotations: { title: 'Read a CMeIn information page', readOnlyHint: true, openWorldHint: true },
    },
    async ({ topic }) =>
      counted('cmein_info', async () => {
        const p = await page(topic);
        return {
          ...text(`${p.text}\n\n---\nFrom ${p.url} (read ${p.fetchedAt}).`),
          structuredContent: { topic, url: p.url, fetched_at: p.fetchedAt },
        };
      }),
  );

  server.registerTool(
    'contact_us',
    {
      title: 'Send a message to CMeIn',
      description:
        'Sends a message to CMeIn\'s support inbox and gets a reply by email. For questions the ' +
        'articles and pages do not answer, problems with an order, or anything that needs a person. ' +
        'Needs an email address to reply to. No account needed. This sends a real message to a real ' +
        'person — only call it when someone has asked to be put in touch, and show them the text ' +
        'first. For a refund of unspent credits, see the refund policy via cmein_info("refund").',
      inputSchema: {
        email: z.string().email().max(255).describe('Where the reply should go. Required.'),
        subject: z.string().min(3).max(200).describe('One line saying what it is about.'),
        message: z.string().min(10).max(5000).describe('The message, in the person\'s own words.'),
        name: z.string().max(120).optional().describe('What to call them, if they said.'),
      },
      // Not read-only, and not destructive either: it adds a message to an inbox and nothing is
      // overwritten or lost. idempotentHint is false on purpose — calling it twice sends two.
      annotations: {
        // The portal reads annotations.title, not the tool-level title, and lists a tool without one
        // as unnamed. Both are set: the tool field is what the specification says, the annotation is
        // what the directory actually renders.
        title: 'Send a message to CMeIn',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ email, subject, message, name }) =>
      counted('contact_us', async () => {
        const res = await fetch(`${ORIGIN}/api/contact/public`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ email, subject, message, name: name ?? null }),
          signal: AbortSignal.timeout(20_000),
        });
        const body = (await res.json().catch(() => null)) as any;

        if (!res.ok) {
          // The app's own refusals are worth repeating verbatim — "this address already has two
          // open messages" tells the caller what to do, where a generic failure does not.
          const why = body?.message ?? body?.error ?? `the server answered ${res.status}`;
          return {
            ...text(
              `The message was not sent: ${why}\n\n` +
                `You can always write to support@cmein.com directly, or use ${ORIGIN}/contact.`,
            ),
            isError: true,
            structuredContent: { sent: false, status: res.status },
          };
        }

        return {
          ...text(body?.message ?? `Your message reached CMeIn. The reply goes to ${email}.`),
          structuredContent: { sent: true },
        };
      }),
  );

  /**
   * The tools that need an account.
   *
   * Registered whether or not this request carried a token, because a tool nobody can see is a tool
   * nobody connects for: the listing is how a client learns these exist, and calling one is what
   * triggers the 401 that starts the OAuth flow. Reaching a handler means the request already passed
   * that gate, so `caller` is non-null here by construction.
   */
  const authed = <T extends AuthedTool>(
    name: T,
    title: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    annotations: Record<string, boolean>,
  ) =>
    server.registerTool(
      name,
      {
        title,
        description: `${description} Needs the "${SCOPES[name]}" permission.`,
        inputSchema,
        // The title is repeated into the annotations because that is where the connector directory
        // reads it from; without it every tool is listed as unnamed.
        annotations: { title, ...annotations },
      },
      async (args: any) =>
        counted(name, async () => {
          if (!caller) {
            return {
              ...text('Connect your CMeIn account to use this.'),
              isError: true,
            };
          }
          return run(name, caller, args);
        }),
    );

  authed('my_credits', 'How many credits you have',
    'The credit balance on the signed-in CMeIn account, and roughly how many photos that buys.',
    {}, { readOnlyHint: true, openWorldHint: true });

  authed('my_generations', 'What you have made',
    'The most recent photos generated on this account — the scene each one was, whether it finished, ' +
    'and when. The images themselves stay in the app rather than passing through here.',
    { limit: z.number().int().min(1).max(25).optional().describe('How many to list. Default 10.') },
    { readOnlyHint: true, openWorldHint: true });

  authed('find_scene', 'Find a scene to be photographed in',
    'Searches CMeIn\'s scene catalogue — over 4,500 settings, filtered to the ones that suit this ' +
    'account. Use it to recommend one: describe what the person is after and it finds the scenes ' +
    'that fit. Generating the photo itself is done in the app.',
    {
      q: z.string().max(80).optional().describe('A place, activity or setting — "cafe", "hiking", "rooftop".'),
      limit: z.number().int().min(1).max(40).optional().describe('How many to return. Default 12.'),
    },
    { readOnlyHint: true, openWorldHint: true });

  authed('request_credits_back', 'Ask for credits back',
    'Opens a request for credits to be returned when a generated photo did not look like the person. ' +
    'It goes to a human and is answered by email; the refund policy decides the outcome, not this tool.',
    {
      reason: z.string().min(10).max(5000).describe('What was wrong with the photo, in the person\'s own words.'),
      generationId: z.string().uuid().optional().describe('The generation it is about, from my_generations.'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// Nothing this host serves is a page, and Search Console covers every subdomain, so Google keeps
// finding it and keeps filing a different complaint about it. The history is a loop: with no
// robots.txt it reported a 404; Disallow: / silenced that and produced "Blocked by robots.txt"
// instead. Both are the same mistake in opposite directions, because a URL Google is forbidden to
// fetch is a URL that can never learn it should be dropped, so it sits in the report forever.
// This header is the way out: let the crawl through, and answer it with the instruction. Google
// fetches once, sees noindex, drops the host, and stops asking. MCP clients ignore it entirely.
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

/**
 * RFC 9728. The document a 401 points a client at, naming the server that can grant access.
 *
 * Served from the root rather than beside /mcp because that is where the spec says a client looks,
 * and a client that cannot find this simply reports "unauthorized" forever.
 */
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json(protectedResourceMetadata());
});
app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  res.json(protectedResourceMetadata());
});

// This host is an API for MCP clients, not a website. It used to answer Disallow: / here, which
// was meant to stop Googlebot reporting a mangled address (/mcp:0, picked up from some directory)
// as a 404. It did stop that, and bought "Blocked by robots.txt" in its place.
//
// So this now says Allow, which looks backwards and is not: the deindexing is done by the
// X-Robots-Tag set on every response above, and Google has to be allowed to fetch the URL before
// it can read the header that removes it. Disallow blocks the fetch and therefore blocks the
// instruction. MCP clients do not read robots.txt, so this changes nothing for them.
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

app.get('/health', (_req, res) => {
  const s = { ...state(), ...videos.state(), calls: usage() };
  // Loaded is the real question. The process being up while the index is empty is a tool that
  // answers nothing, and a health check that calls that healthy is worth nothing.
  res.status(s.articles > 0 ? 200 : 503).json({ ok: s.articles > 0, ...s });
});

/**
 * Streamable HTTP, stateless: a transport per request, closed with it.
 *
 * Stateless because there is no session to keep — none of these tools holds anything between calls,
 * and a server with no state scales sideways and survives a restart mid-conversation. Sessions come
 * when authenticated tools do.
 */
/** Does this JSON-RPC body call a tool that needs an account? Arrays are batches; any one counts. */
function needsAccount(body: unknown): boolean {
  const one = (m: any) =>
    m?.method === 'tools/call' && AUTHED_TOOLS.includes(m?.params?.name as AuthedTool);
  return Array.isArray(body) ? body.some(one) : one(body);
}

app.post('/mcp', async (req, res) => {
  // The whole endpoint is never 401'd, because the public tools are the front door and a connector
  // that demands an account before it has been useful once does not get connected. But a client only
  // starts the OAuth flow because a 401 told it to — so the challenge is returned exactly when an
  // account-bound tool is actually called.
  const caller = await verify(bearer(req.headers.authorization));
  if (!caller && needsAccount(req.body)) {
    res.setHeader('WWW-Authenticate', challenge('invalid_token', 'Connect your CMeIn account.'));
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'This tool needs a connected CMeIn account.' },
      id: null,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
  });
  try {
    const server = buildServer(caller);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('mcp request failed', e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal error' },
        id: randomUUID(),
      });
    }
  }
});

// GET and DELETE on /mcp are the session-bound half of the transport, which stateless mode has no
// use for. Answering them properly beats letting Express return a bare 404 the client cannot read.
const noSession = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'This server is stateless; use POST /mcp.' },
    id: null,
  });

/**
 * A person who opens this URL gets a page; a client gets the protocol answer.
 *
 * This address is printed on the website and pasted into chats, so it gets clicked, and the first
 * version answered a click with a JSON-RPC error about statelessness — correct, and useless to the
 * human reading it. The split is on Accept: anything asking for an event stream or JSON is a client
 * and gets the 405 it can parse.
 */
/**
 * A person is sent to the real page; a client gets the protocol answer.
 *
 * This used to serve its own small HTML page, and that was a mistake worth naming: cmein.com/mcp
 * already explains this connector, with the diagram, the reasons and the copyable address, and it is
 * designed, prerendered for crawlers and maintained. A second explanation living here would have
 * drifted from it within a week, and which one a reader got would have been luck.
 *
 * So there is one page, and this redirects to it. The split stays on Accept: anything asking for an
 * event stream or JSON is a client and gets the 405 it can parse, never a redirect it would follow
 * into HTML.
 */
const humanOrClient = (req: express.Request, res: express.Response) => {
  const accept = String(req.headers.accept ?? '');
  if (accept.includes('text/event-stream') || accept.includes('application/json')) {
    return noSession(req, res);
  }
  // 302, not 301: the day this endpoint serves something of its own, a cached permanent redirect in
  // everyone's browser would be a problem with no way to take it back.
  return res.redirect(302, `${ORIGIN}/mcp`);
};

app.get('/', humanOrClient);
app.get('/mcp', humanOrClient);
app.delete('/mcp', noSession);

startSyncing();
videos.startSyncing();
app.listen(PORT, () => console.log(`cmein-mcp listening on ${PORT}, reading ${ORIGIN}`));
