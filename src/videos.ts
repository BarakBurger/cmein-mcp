/**
 * The shorts, read from YouTube's own feed.
 *
 * Every one of these was made with CMeIn — the characters in them are generated, which is the
 * argument the films are making. So "is there a video about this" is a fair question to answer, and
 * answering it with a link to a 40-second film beats answering it with a paragraph.
 *
 * Source is the channel's RSS feed. Not the YouTube Data API, which would need a key and a quota
 * for fifteen rows; not the channel page, which answers a datacenter IP with a consent wall and a
 * captcha. The feed is public, stable, and carries the title, the full description, the thumbnail
 * and the view and like counts.
 *
 * Its limit, and it is a real one: the feed holds the **15 most recent** videos and nothing older.
 * There is no paging. So this tool searches the recent catalogue, not the whole channel, and says
 * so rather than implying it looked everywhere.
 */
import { count, index, score, terms, type Counted, type Index } from './bm25.js';
import { YOUTUBE_CHANNEL_ID } from './links.js';

const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
const SYNC_EVERY_MS = Number(process.env.VIDEO_SYNC_MINUTES ?? 180) * 60_000;

export type Video = {
  id: string;
  title: string;
  description: string;
  url: string;
  published: string | null;
  views: number | null;
  likes: number | null;
  counted: Counted;
};

let videos: Video[] = [];
let idx: Index = index([]);
let syncedAt: Date | null = null;
let lastError: string | null = null;

export function state() {
  return {
    videos: videos.length,
    videos_synced_at: syncedAt ? syncedAt.toISOString() : null,
    videos_last_error: lastError,
  };
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&amp;/g, '&');

const one = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m?.[1] == null ? null : unescape(m[1]).trim();
};

export async function sync(): Promise<void> {
  const res = await fetch(FEED, {
    headers: { accept: 'application/atom+xml', 'user-agent': 'cmein-mcp' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`video sync: YouTube answered ${res.status}`);
  const xml = await res.text();

  const next: Video[] = [];
  for (const block of xml.split('<entry>').slice(1)) {
    const id = one(block, 'yt:videoId');
    const title = one(block, 'title') ?? one(block, 'media:title');
    if (!id || !title) continue;
    const views = block.match(/<media:statistics[^>]*views="(\d+)"/);
    const likes = block.match(/<media:starRating[^>]*count="(\d+)"/);
    const description = one(block, 'media:description') ?? '';
    next.push({
      id,
      title,
      description,
      // The /shorts/ form, because that is what these are and what the feed's own link says.
      url: `https://www.youtube.com/shorts/${id}`,
      published: one(block, 'published'),
      views: views?.[1] ? Number(views[1]) : null,
      likes: likes?.[1] ? Number(likes[1]) : null,
      // The hashtags at the end of a description are the only topic labels these films carry, so
      // they go into the count with everything else rather than being stripped as noise.
      counted: count(description, title),
    });
  }
  if (next.length === 0) throw new Error('video sync: no entries in the feed');

  videos = next;
  idx = index(next.map(v => v.counted));
  syncedAt = new Date();
  lastError = null;
}

export function startSyncing(): void {
  const run = () =>
    sync()
      .then(() => console.log(`videos synced: ${videos.length}`))
      .catch(e => {
        lastError = String(e?.message ?? e);
        console.error(`video sync failed: ${lastError}`);
      });
  void run();
  setInterval(run, SYNC_EVERY_MS).unref();
}

export type Match = Omit<Video, 'counted'> & { score: number };

const strip = ({ counted, ...rest }: Video): Omit<Video, 'counted'> => rest;

/** The most recent films, newest first — what to show when there is no question to match. */
export function latest(limit = 5): Match[] {
  return videos.slice(0, limit).map(v => ({ ...strip(v), score: 0 }));
}

/**
 * The films that match a question. Empty when none do.
 *
 * Deliberately empty rather than quietly returning the newest instead: a caller handed three
 * unrelated films as if they were matches will present them as answers. Offering the latest is the
 * right fallback, but it has to be labelled as one, which is the tool's job and not this function's.
 */
export function search(question: string, limit = 3): Match[] {
  const q = terms(question);
  if (q.length === 0 || videos.length === 0) return latest(limit);

  const hits = videos
    .map(v => ({ v, s: score(v.counted, q, idx) }))
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit);

  if (hits.length === 0) return [];
  return hits.map(({ v, s }) => ({ ...strip(v), score: Math.round(s * 100) / 100 }));
}
