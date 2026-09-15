/**
 * CORS support for the portal API
 *
 * Browser clients (clinic-app) send the Supabase anon key in Authorization and
 * the portal JWT in X-Portal-Token, so both headers must be allow-listed.
 */

const ALLOWED_HEADERS = "authorization, apikey, content-type, x-portal-token, x-client-info";
const ALLOWED_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";

/**
 * Origins permitted to call the API, from the ALLOWED_ORIGINS env var
 * (comma-separated). Unset means allow any origin.
 */
function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowList = allowedOrigins();

  let allowOrigin: string | null;
  if (allowList.length === 0) {
    allowOrigin = "*";
  } else if (origin && allowList.includes(origin)) {
    allowOrigin = origin;
  } else {
    // Unknown origin: omit the header so the browser blocks the response.
    allowOrigin = null;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must key on Origin.
    "Vary": "Origin"
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

/**
 * Wrap a request handler so preflights are answered and every response
 * carries CORS headers, including ones built inline by the handler.
 */
export function withCors(
  handler: (req: Request) => Response | Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const response = await handler(req);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
}
