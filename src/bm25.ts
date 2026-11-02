/**
 * BM25, once, for everything here that is searched by words.
 *
 * It arrived in blog.ts to fix a specific wrong answer — scoring by presence returned a Love Island
 * essay for "what should I wear", because "dating" sat in its title and a title match was worth a
 * flat bonus. BM25 fixes the two causes: term frequency saturates, so an article that says "dating"
 * forty times stops gaining, and the score is normalised by length, so a long document no longer
 * wins for being long.
 *
 * It lives in its own file because the videos are searched the same way and a second copy of this
 * would be a second place for the constants to drift.
 */

const K1 = 1.4;           // how fast term frequency saturates
const B = 0.72;           // how hard length is normalised
export const TITLE_REPEATS = 4;  // a title term counts as if the body said it four times

/** Words in almost every document here, which would otherwise decide the match. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'your', 'my', 'our', 'their', 'its',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'about', 'into', 'over',
  'what', 'which', 'who', 'how', 'why', 'when', 'where', 'can', 'will', 'would', 'should',
  'not', 'no', 'so', 'just', 'more', 'most', 'some', 'any', 'all', 'one', 'two', 'up', 'out',
  'photo', 'photos', 'picture', 'pictures', 'image', 'images',   // true of the whole corpus
]);

export function terms(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length > 2 && !STOP.has(w));
}

/** What a document contributes to the index: its own term counts and its length. */
export type Counted = {
  tf: Map<string, number>;
  length: number;
};

/**
 * Count a document once, at sync time rather than on every question.
 *
 * `head` — a title, a target keyword — is repeated into the count because it says what the document
 * is FOR. As extra occurrences, weighted like any other term, not as a multiplier bolted on at
 * scoring time: that bolted-on multiplier is exactly what produced the Love Island answer.
 */
export function count(body: string, head = ''): Counted {
  const b = terms(body);
  const h = terms(head);
  const tf = new Map<string, number>();
  for (const t of b) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const t of h) tf.set(t, (tf.get(t) ?? 0) + TITLE_REPEATS);
  return { tf, length: b.length + h.length * TITLE_REPEATS };
}

export type Index = {
  /** How many documents mention each term — the basis for weighting a rare word over a common one. */
  docFreq: Map<string, number>;
  /** Mean document length, the yardstick the score normalises against. */
  avgLength: number;
  size: number;
};

export function index(docs: Counted[]): Index {
  const docFreq = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  return {
    docFreq,
    avgLength: Math.max(1, docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length)),
    size: docs.length,
  };
}

/** One document's score for an already-tokenised query. Zero means no query term appears. */
export function score(doc: Counted, query: string[], idx: Index): number {
  let total = 0;
  for (const t of new Set(query)) {
    const tf = doc.tf.get(t) ?? 0;
    if (tf === 0) continue;
    const df = idx.docFreq.get(t) ?? idx.size;
    // Standard BM25 idf, floored so a term in almost every document cannot go negative.
    const idf = Math.max(0.05, Math.log(1 + (idx.size - df + 0.5) / (df + 0.5)));
    total += idf * (tf * (K1 + 1) / (tf + K1 * (1 - B + B * (doc.length / idx.avgLength))));
  }
  return total;
}
