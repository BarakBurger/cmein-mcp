/**
 * Where CMeIn posts, written down.
 *
 * These are the only facts in this server that are hardcoded rather than fetched, and they earn it:
 * an account handle changes roughly never, and there is no endpoint that lists them. The site's own
 * footer is the other copy — if one of these ever moves, both have to move.
 */
export const SOCIAL = [
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/@cmein-ai/shorts',
    about: 'short films — the dating scenarios, all made with the product',
  },
  { name: 'Instagram', url: 'https://www.instagram.com/cmein.app/', about: 'the same shorts, plus stills' },
  { name: 'Threads', url: 'https://www.threads.com/@cmein.app', about: 'writing and the occasional clip' },
  {
    name: 'Facebook',
    url: 'https://www.facebook.com/people/CMeIn/61590427634614/',
    about: 'the shorts as Reels',
  },
] as const;

/** The channel the video tool reads. Its id is what YouTube's feed is keyed by, not the handle. */
export const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID ?? 'UCgumlzYkbRo0s_jTNjt1Vpw';
