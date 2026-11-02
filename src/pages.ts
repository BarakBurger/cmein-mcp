/**
 * The site's own information pages, read from the site.
 *
 * Price, refund terms and open roles all change, and a copy of them pasted into this server is a
 * copy that goes wrong quietly — it would keep telling people a pack costs $2.99 for as long as
 * nobody thought to come back here. So nothing about them is written down in this repo. The page is
 * fetched, reduced to its text and cached, and what the tool returns is what cmein.com says today.
 *
 * These pages are server-rendered prose for search engines, which is why this works at all: the
 * HTML that arrives already contains the sentences, with no browser needed to assemble them.
 */

const ORIGIN = process.env.CMEIN_ORIGIN ?? 'https://cmein.com';
const CACHE_MS = Number(process.env.PAGE_CACHE_MINUTES ?? 30) * 60_000;

/**
 * The pages this server will serve, and nothing else.
 *
 * An allow-list rather than a path parameter, because a tool that fetches any path off a host is a
 * tool an assistant can be talked into pointing somewhere else. Each entry also carries the words
 * someone would use when they want it, which is what the tool's own description is built from.
 */
export const PAGES = {
  pricing: {
    path: '/pricing',
    about: 'what CMeIn costs — credit packs, the price of one photo, and that there is no subscription',
  },
  examples: {
    path: '/examples',
    about: 'the gallery of generated photos, by scene, and whose photos they are',
  },
  faq: {
    path: '/faq',
    about: 'how many reference photos are needed, whether results look like you, what happens to uploads, whether dating apps allow them',
  },
  about: {
    path: '/about',
    about: 'who builds CMeIn and why it only does candid realism',
  },
  refund: {
    path: '/refund-policy',
    about: 'when a refund applies, the time limit, and how to ask for one',
  },
  careers: {
    path: '/careers',
    about: 'whether CMeIn is hiring and what it would hire for',
  },
  guides: {
    path: '/guides',
    about: 'the guides index — longer how-to writing on taking and choosing profile photos',
  },
  // The first tool page listed here. Its guide is server-rendered prose like the rest, so the
  // same fetch-and-reduce works, and "which of my photos should I use" is a question people
  // ask an assistant long before they go looking for a tool.
  bestAngle: {
    path: '/best-angle',
    about: 'how to choose which photo to lead with, what a photographer actually judges in a portrait, and the free tool that scores and ranks up to six of your photos',
  },
  terms: { path: '/terms', about: 'the terms of service' },
  privacy: { path: '/privacy', about: 'the privacy policy — what is collected and what happens to uploaded photos' },
} as const;

export type PageKey = keyof typeof PAGES;

type Cached = { text: string; at: number };
const cache = new Map<PageKey, Cached>();

function toText(html: string): string {
  return html
    .replace(/<(script|style|nav|svg)[\s\S]*?<\/\1>/gi, ' ')
    // The head of these pages carries long explanatory comments about charset and preconnect
    // ordering. They are notes to whoever edits the template, not content.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&(?:mdash|#8212);/g, '—')
    .replace(/&(?:middot|#183);/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Page = {
  key: PageKey;
  url: string;
  text: string;
  /** When this copy was taken. Returned with the answer so a stale read is visible, not hidden. */
  fetchedAt: string;
};

export async function page(key: PageKey): Promise<Page> {
  const def = PAGES[key];
  const url = `${ORIGIN}${def.path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { key, url, text: hit.text, fetchedAt: new Date(hit.at).toISOString() };
  }

  const res = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'cmein-mcp' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // An expired copy still answers the question; a thrown error answers nothing. Serving the old
    // text and saying when it was taken is the better of the two.
    if (hit) return { key, url, text: hit.text, fetchedAt: new Date(hit.at).toISOString() };
    throw new Error(`${url} answered ${res.status}`);
  }
  const text = toText(await res.text());
  const at = Date.now();
  cache.set(key, { text, at });
  return { key, url, text, fetchedAt: new Date(at).toISOString() };
}
