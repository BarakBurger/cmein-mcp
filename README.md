# CMeIn MCP server

Connect [CMeIn](https://cmein.com) to Claude, ChatGPT, Cursor, Codex, Grok or Gemini CLI. Ask about
dating-profile photos and get answers from what CMeIn has actually written, with the source links.
Connect your account and your assistant can check your credits, see what you have made, and find
the next scene to shoot.

CMeIn turns a handful of ordinary phone photos of you into realistic, candid photos of you out in
the world: at a cafe, on a hike, at a friend's dinner. No studio headshots, no beauty filter.

**Server address:** `https://mcp.cmein.com/mcp` (streamable HTTP)

More on the product page: [cmein.com/mcp](https://cmein.com/mcp)

## Connect it

**Claude Code**, one command:

```bash
claude mcp add --transport http cmein https://mcp.cmein.com/mcp
```

**Everywhere else** (Claude, ChatGPT, Cursor, Codex, Grok, Gemini CLI) the setting is called a
custom connector, an MCP server or an MCP app, and it asks for a URL. Paste
`https://mcp.cmein.com/mcp`. In ChatGPT it is under Plugins, Add, Create MCP App.

The six public tools work straight away. The four account tools ask you to sign in to CMeIn once.

## Tools

### No account needed

| Tool | Ask it | What it does |
|---|---|---|
| `photo_advice` | "Are AI dating photos catfishing?" | Answers from CMeIn's [published articles](https://cmein.com/blog), with the passages and their links |
| `cmein_pricing` | "What does CMeIn cost?" | Reads the live [pricing page](https://cmein.com/pricing), so the figure is current |
| `see_examples` | "Show me what the photos look like" | Points at the [examples gallery](https://cmein.com/examples) and where new work is posted |
| `find_video` | "Is there a CMeIn film about who pays on a first date?" | Finds the short on [YouTube](https://www.youtube.com/@cmein-ai/shorts) and links it |
| `cmein_info` | "What is the refund policy?" | Reads the policy page itself: [FAQ](https://cmein.com/faq), [refunds](https://cmein.com/refund-policy), [terms](https://cmein.com/terms), [privacy](https://cmein.com/privacy) and more |
| `contact_us` | "Ask CMeIn whether my photos would work" | Sends a message to a real person, who replies by email |

### With your CMeIn account

One approval screen on cmein.com lists exactly what you are granting.

| Tool | Ask it | Scope |
|---|---|---|
| `my_credits` | "How many CMeIn credits do I have?" | `credits:read` |
| `my_generations` | "What have I generated lately?" | `photos:read` |
| `find_scene` | "Find me a CMeIn scene in a cafe" | `scenes:read`, searches over 4,500 scenes |
| `request_credits_back` | "Ask CMeIn for credits back, it does not look like me" | `support:write`, opens a request a person answers |

### What it does not do

- **It does not generate photos.** That happens in the [app](https://cmein.com).
- **Your photographs never pass through it.** "What have I made" answers with scenes and dates, not
  images. Routing your pictures through another company's chat logs buys you nothing.
- **It cannot spend your credits.** There is no write scope for photos, by design.

## How it works

- **Advice** is BM25 search over CMeIn's own articles, with the title and target keyword weighted.
  It returns passages and links, not a summary, so the assistant can quote and you can check.
- **Prices, policies and pages** are fetched live from cmein.com through a fixed allow-list of
  paths. Nothing is answered from memory.
- **Account tools** are thin calls to cmein.com's API carrying your own access token. This server is
  an OAuth resource server only: it holds no secrets, mints no tokens, and verifies each token
  against cmein.com's published signing keys, checking the issuer and that the token was issued for
  this server (RFC 8707). Credits, terms and limits are enforced by cmein.com, not here.

## Run it yourself

Node 22 or newer.

```bash
npm install
npm run build
node dist/index.js
```

It listens on port 8000 and syncs the articles on boot. `GET /health` answers 503 until the article
index is built, then 200.

| Env | Default | |
|---|---|---|
| `PORT` | `8000` | |
| `CMEIN_ORIGIN` | `https://cmein.com` | where articles, pages and the account API come from |
| `MCP_RESOURCE` | `https://mcp.cmein.com/mcp` | the audience a token must carry |
| `BLOG_SYNC_MINUTES` | `60` | how often the article copy refreshes |
| `PAGE_CACHE_MINUTES` | `30` | how long a fetched page is reused |
| `VIDEO_SYNC_MINUTES` | `180` | how often the video feed refreshes |

A self-hosted copy serves the public tools fine. The account tools are meant for the hosted
address: CMeIn issues tokens for `https://mcp.cmein.com/mcp` only.

A `Dockerfile` is included: a two-stage build that runs as a non-root user with a health check.

## Links

- [cmein.com](https://cmein.com): the product
- [cmein.com/mcp](https://cmein.com/mcp): this connector, for people rather than developers
- [Blog](https://cmein.com/blog): the articles `photo_advice` answers from
- [Guides](https://cmein.com/guides) and the free [Best Angle](https://cmein.com/best-angle) tool
- [YouTube](https://www.youtube.com/@cmein-ai/shorts), [Instagram](https://www.instagram.com/cmein.app/),
  [Threads](https://www.threads.com/@cmein.app), [Facebook](https://www.facebook.com/people/CMeIn/61590427634614/)

Questions or a bug: open an issue here, or ask the connector itself with `contact_us`.

## License

[MIT](LICENSE)
