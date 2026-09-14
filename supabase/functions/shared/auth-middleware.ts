/**
 * Authentication Middleware
 * 
 * Middleware for protecting API endpoints and checking roles
 * Use in API handlers to verify authentication and authorization
 */

import { validateRequest, hasRole, TokenPayload } from "./jwt-auth.ts";
import { debug } from "./logger.ts";

export interface AuthContext {
  user: TokenPayload;
  isAuthenticated: boolean;
}

/**
 * Authentication error response
 */
export function unauthorizedResponse(message: string = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }
  );
}

/**
 * Forbidden error response
 */
export function forbiddenResponse(message: string = "Forbidden"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" }
    }
  );
}

/**
 * Bad request error response
 */
export function badRequestResponse(message: string = "Bad Request"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }
  );
}

/**
 * Server error response
 */
export function errorResponse(error: string | Error, statusCode: number = 500): Response {
  const message = error instanceof Error ? error.message : error;
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" }
    }
  );
}

/**
 * Success response
 */
export function successResponse(data: any, statusCode: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" }
    }
  );
}

/**
 * Require authentication
 * Use at start of API handlers
 * 
 * @param req - Request object
 * @returns { user, isAuthenticated } or null
 */
export async function requireAuth(req: Request): Promise<TokenPayload | null> {
  const payload = await validateRequest(req);

  if (!payload) {
    debug("authMiddleware", "Authentication failed");
    return null;
  }

  debug("authMiddleware", "Request authenticated", {
    userId: payload.userId,
    role: payload.role
  });

  return payload;
}

/**
 * Require specific role(s)
 * Use after requireAuth
 * 
 * @param payload - Token payload from requireAuth
 * @param requiredRoles - Role(s) required
 * @returns true if authorized
 */
export function requireRole(
  payload: TokenPayload | null,
  requiredRoles: TokenPayload["role"] | TokenPayload["role"][]
): boolean {
  if (!payload) return false;
  return hasRole(payload, requiredRoles);
}

/**
 * API endpoint wrapper with auth
 * Combines requireAuth + requireRole + error handling
 * 
 * Usage:
 * ```
 * export async function handler(req: Request) {
 *   return withAuth(req, ["DOCTOR", "RECEPTIONIST"], async (user) => {
 *     // Handler logic here
 *     return successResponse({ data: "..." });
 *   });
 * }
 * ```
 */
export async function withAuth(
  req: Request,
  requiredRoles: TokenPayload["role"] | TokenPayload["role"][] | null,
  handler: (user: TokenPayload) => Promise<Response>
): Promise<Response> {
  try {
    // Check authentication
    const user = await requireAuth(req);
    if (!user) {
      return unauthorizedResponse("Missing or invalid authentication token");
    }

    // Check role (if specified)
    if (requiredRoles && !requireRole(user, requiredRoles)) {
      const roles = Array.isArray(requiredRoles)
        ? requiredRoles.join(", ")
        : requiredRoles;
      return forbiddenResponse(`This endpoint requires role: ${roles}`);
    }

    // Call handler with authenticated user
    return await handler(user);
  } catch (error) {
    debug("authMiddleware", "Handler error", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Log API request
 */
export function logApiRequest(
  endpoint: string,
  method: string,
  user: TokenPayload | null,
  statusCode: number
): void {
  debug("api", `${method} ${endpoint}`, {
    user: user?.userId || "anonymous",
    role: user?.role || "none",
    status: statusCode
  });
}
