/**
 * Proving who an assistant is acting for.
 *
 * This server is a resource server and nothing more: it mints no tokens, holds no secret, and knows
 * nothing about passwords. It verifies a signature against cmein.com's published public keys, and
 * it checks three things that matter more than the signature does.
 *
 *   The issuer must be cmein.com. A valid token from somewhere else is somebody else's token.
 *
 *   The audience must be this server. RFC 8707 exists because a token obtained for one resource used
 *   to be replayable against any other that trusted the same issuer; refusing a token whose audience
 *   is not us is the whole mitigation, and it is one line that is easy to leave out.
 *
 *   The scope must cover the tool being called. A grant of "see my credits" is not a grant of "spend
 *   them", and the person chose between those on the consent screen.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = process.env.CMEIN_ORIGIN ?? 'https://cmein.com';
/** What this server calls itself. A token minted for anything else is refused. */
export const RESOURCE = process.env.MCP_RESOURCE ?? 'https://mcp.cmein.com/mcp';

/**
 * jose caches the key set and refetches on an unknown kid, with its own rate limit — which is what
 * makes key rotation work without a deploy here, and what stops a stream of bad tokens turning into
 * a stream of requests to cmein.com.
 */
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
  cooldownDuration: 30_000,
  timeoutDuration: 8_000,
});

export type Caller = {
  userId: string;
  email: string | null;
  clientId: string | null;
  scopes: Set<string>;
  /** Kept so a tool can call cmein.com as this person rather than as the server. */
  token: string;
};

export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

/**
 * Verify a bearer token. Returns null for anything that does not check out — never a partial caller,
 * because "authenticated but we are not sure as whom" is not a state any tool should have to handle.
 */
export async function verify(token: string | null): Promise<Caller | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: RESOURCE,
      algorithms: ['RS256'],
      clockTolerance: 30,
    });
    if (!payload.sub) return null;
    return {
      userId: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : null,
      clientId: typeof payload.client_id === 'string' ? payload.client_id : null,
      scopes: new Set(String(payload.scope ?? '').split(/\s+/).filter(Boolean)),
      token,
    };
  } catch (e) {
    // Expiry is the common case and is not worth a line in the log every fifteen minutes.
    const code = (e as any)?.code;
    if (code !== 'ERR_JWT_EXPIRED') console.warn('token rejected:', code ?? String(e));
    return null;
  }
}

/** RFC 9728. The document a client is pointed at by the 401, telling it where to go and ask. */
export function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    // photos:write is deliberately absent. The server still defines and enforces it, but no tool
    // here uses it, and a consent screen that asks for a permission nothing exercises is asking for
    // more than it needs.
    scopes_supported: ['credits:read', 'photos:read', 'scenes:read', 'support:write'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${ISSUER}/mcp`,
  };
}

/**
 * The header that starts the whole OAuth dance.
 *
 * A client does not go looking for an authorization server on its own — it does it because a 401
 * told it where to look. Getting this header wrong means a client that simply reports "unauthorized"
 * forever and never offers to connect.
 */
export function challenge(error?: string, description?: string): string {
  const parts = [
    `Bearer resource_metadata="${RESOURCE.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(', ');
}
