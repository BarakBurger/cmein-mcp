/**
 * The blog, held here rather than read live.
 *
 * Every article is already in CMeIn's own database and served by /api/blog/posts — all 152 of them,
 * with their full HTML, in a single 1.1MB response. So the sync is one request on a timer, not a
 * crawl.
 *
 * Why a copy at all: serving the articles is cheap, but SEARCHING them is not, and that work has no
 * business running inside the app customers pay to generate photos in. The public tool is also the
 * only one with no account behind it — it is the front door to the connector directories, and the
 * likeliest thing to take a sudden spike. A spike here must not reach the product.
 *
 * The cost, accepted knowingly: this copy can go stale. An article is edited, the tool keeps
 * answering from the old text, and nothing looks broken. That is paid for with visibility rather
 * than cleverness — every answer carries when the content was last synced, so the gap is on screen
 * instead of in a support ticket.
 */

import { count, index, score, terms, type Counted, type Index } from './bm25.js';

export type Article = {
  slug: string;
  title: string;
  metaDescription: string | null;
  targetKeyword: string | null;
  category: string | null;
  publishDate: string | null;
  readingMinutes: number | null;
  html: string;
  /** The body as plain text, built once at sync time — searching HTML matches tag names. */
  text: string;
  /** Term counts for the search, built at sync. */
  counted: Counted;
};

export type Passage = {
  slug: string;
  title: string;
  url: string;
  category: string | null;
  text: string;
  score: number;
};

const ORIGIN = process.env.CMEIN_ORIGIN ?? 'https://cmein.com';
const SYNC_EVERY_MS = Number(process.env.BLOG_SYNC_MINUTES ?? 60) * 60_000;

let articles: Article[] = [];
let syncedAt: Date | null = null;
let lastError: string | null = null;
let idx: Index = index([]);

export function state() {
  return {
    articles: articles.length,
    synced_at: syncedAt ? syncedAt.toISOString() : null,
    last_error: lastError,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function sync(): Promise<void> {
  const res = await fetch(`${ORIGIN}/api/blog/posts`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`blog sync: ${ORIGIN} answered ${res.status}`);
  const raw = (await res.json()) as any[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('blog sync: no articles returned');

  const next: Article[] = raw
    .filter(p => typeof p?.slug === 'string' && typeof p?.html === 'string')
    .map(p => ({
      slug: p.slug,
      title: p.title ?? p.slug,
      metaDescription: p.metaDescription ?? null,
      targetKeyword: p.targetKeyword ?? null,
      category: p.category ?? null,
      publishDate: p.publishDate ?? null,
      readingMinutes: p.readingMinutes ?? null,
      html: p.html,
      text: stripHtml(p.html),
      counted: { tf: new Map(), length: 0 },
    }));

  for (const a of next) a.counted = count(a.text, `${a.title} ${a.targetKeyword ?? ''}`);

  // Only swap once the new set is in hand. A failed sync leaves the previous corpus serving rather
  // than emptying the tool, because stale answers beat no answers.
  const nextIdx = index(next.map(a => a.counted));

  articles = next;
  idx = nextIdx;
  syncedAt = new Date();
  lastError = null;
}

export function startSyncing(): void {
  const run = () =>
    sync()
      .then(() => console.log(`blog synced: ${articles.length} articles`))
      .catch(e => {
        lastError = String(e?.message ?? e);
        console.error(`blog sync failed: ${lastError}`);
      });
  void run();
  setInterval(run, SYNC_EVERY_MS).unref();
}

/**
 * Find the passages that answer a question.
 *
 * BM25, which is the standard answer and the right amount of machinery for 152 articles. The first
 * attempt scored presence — does the word appear, is it in the title — and it was wrong on the very
 * first question asked of it: "what should I wear" returned an essay about Love Island, because
 * that title contains "dating" and the scoring rewarded a common word sitting in a title.
 *
 * BM25 fixes the two things that caused it. Term frequency saturates, so an article that says
 * "dating" forty times stops gaining; and the score is normalised by length, so a long article no
 * longer wins for being long. The title still counts for more, but now through the same weighting
 * as everything else rather than as a flat multiplier on top.
 *
 * Still expected to be replaced by embeddings. BM25 matches words, and someone asking "should I
 * smile" and an article titled "The Expression Problem" share none.
 */
export function search(question: string, limit = 3): Passage[] {
  const q = terms(question);
  if (q.length === 0 || articles.length === 0) return [];

  return articles
    .map(a => ({ a, s: score(a.counted, q, idx) }))
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map(({ a, s }) => ({
      slug: a.slug,
      title: a.title,
      url: `${ORIGIN}/blog/${a.slug}`,
      category: a.category,
      text: passage(a, q),
      score: Math.round(s * 100) / 100,
    }));
}

/**
 * The part of the article worth quoting: the window around the densest run of the asked-for terms,
 * cut at sentence boundaries. Returned rather than summarised — the caller's own model will
 * summarise it, and what we want back is the link.
 */
function passage(a: Article, q: string[], chars = 900): string {
  const sentences = a.text.match(/[^.!?]+[.!?]+/g) ?? [a.text];
  if (sentences.length === 0) return a.text.slice(0, chars);

  const hits = sentences.map(s => {
    const low = s.toLowerCase();
    return q.reduce((acc, t) => acc + (low.includes(t) ? 1 : 0), 0);
  });

  let bestAt = 0;
  let best = -1;
  for (let i = 0; i < sentences.length; i++) {
    let window = 0;
    let len = 0;
    for (let j = i; j < sentences.length && len < chars; j++) {
      window += hits[j] ?? 0;
      len += (sentences[j] ?? '').length;
    }
    if (window > best) {
      best = window;
      bestAt = i;
    }
  }

  let out = '';
  for (let j = bestAt; j < sentences.length && out.length < chars; j++) out += sentences[j];
  return out.trim() || a.text.slice(0, chars);
}
