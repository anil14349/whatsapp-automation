/**
 * JWT Authentication Module
 * 
 * Handles JWT token creation and verification for API authentication
 * No external dependencies - uses djwt from deno.land/x
 */

import { create, verify, decode } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { debug } from "./logger.ts";

// JWT_SECRET is required - fail fast if not configured
const JWT_SECRET = Deno.env.get("JWT_SECRET");
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required and must be at least 32 characters. " +
    "Generate with: openssl rand -base64 32"
  );
}

const TOKEN_EXPIRY_HOURS = 24;

// djwt v3 signs and verifies with a CryptoKey, not a raw string. Import it once
// and reuse the promise so concurrent requests share a single key.
let signingKey: Promise<CryptoKey> | null = null;

function getSigningKey(): Promise<CryptoKey> {
  if (!signingKey) {
    signingKey = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return signingKey;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: "DOCTOR" | "RECEPTIONIST" | "ADMIN" | "CLINIC_OWNER";
  clinicId?: string;
  doctorId?: string;
  iat?: number;
  exp?: number;
}

export interface DecodedToken {
  payload: TokenPayload;
  signature: string;
  header: Record<string, string>;
}

/**
 * Create JWT token
 * 
 * @param payload - Token payload (userId, email, role, etc.)
 * @param expiresInHours - Token expiration time in hours (default: 24)
 * @returns JWT token string
 */
export async function createJwtToken(
  payload: Omit<TokenPayload, "iat" | "exp">,
  expiresInHours: number = TOKEN_EXPIRY_HOURS
): Promise<string> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (expiresInHours * 3600);

    const token = await create(
      { alg: "HS256", typ: "JWT" },
      {
        ...payload,
        iat: now,
        exp: expiresAt
      },
      await getSigningKey()
    );

    debug("jwtAuth", "Token created", {
      userId: payload.userId,
      role: payload.role,
      expiresIn: `${expiresInHours}h`
    });

    return token;
  } catch (error) {
    debug("jwtAuth", "Error creating token", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Verify and decode JWT token
 * 
 * @param token - JWT token string
 * @returns Decoded token payload, or null if invalid/expired
 */
export async function verifyJwtToken(token: string): Promise<TokenPayload | null> {
  try {
    // djwt v3 derives the algorithm from the key, so no alg argument is passed.
    const payload = await verify(token, await getSigningKey()) as TokenPayload;

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      debug("jwtAuth", "Token expired", { userId: payload.userId });
      return null;
    }

    debug("jwtAuth", "Token verified", {
      userId: payload.userId,
      role: payload.role
    });

    return payload;
  } catch (error) {
    debug("jwtAuth", "Token verification failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Extract token from Authorization header
 * 
 * @param authHeader - Authorization header value
 * @returns Token string, or null if invalid format
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Decode token without verification (for debugging)
 * WARNING: Use only for logging/debugging, not for authorization
 * 
 * @param token - JWT token string
 * @returns Decoded payload
 */
export function decodeTokenUnsafe(token: string): TokenPayload | null {
  try {
    const decoded = decode(token) as unknown[];
    if (decoded && decoded[1]) {
      return decoded[1] as TokenPayload;
    }
    return null;
  } catch (error) {
    debug("jwtAuth", "Error decoding token", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Refresh token (create new token from existing payload)
 * Useful for extending session without re-authentication
 * 
 * @param oldToken - Current JWT token
 * @param expiresInHours - New expiration time
 * @returns New JWT token, or null if old token invalid
 */
export async function refreshJwtToken(
  oldToken: string,
  expiresInHours: number = TOKEN_EXPIRY_HOURS
): Promise<string | null> {
  const payload = await verifyJwtToken(oldToken);
  if (!payload) return null;

  const { iat, exp, ...rest } = payload;
  return createJwtToken(rest, expiresInHours);
}

/**
 * Validate token and return payload
 * Combined verify + extract operation
 * 
 * @param req - Request object
 * @returns Token payload if valid, null if invalid/missing
 */
export async function validateRequest(req: Request): Promise<TokenPayload | null> {
  // The Supabase gateway validates the Authorization header against its own
  // project JWT, so the portal token travels in a dedicated header. Fall back
  // to Authorization for callers that bypass the gateway.
  const portalToken = req.headers.get("X-Portal-Token");
  const token = portalToken?.trim() || extractTokenFromHeader(req.headers.get("Authorization"));

  if (!token) {
    debug("jwtAuth", "Missing portal token");
    return null;
  }

  return verifyJwtToken(token);
}

/**
 * Check if user has required role
 * 
 * @param payload - Token payload
 * @param requiredRoles - Role(s) required
 * @returns true if user has required role
 */
export function hasRole(
  payload: TokenPayload,
  requiredRoles: TokenPayload["role"] | TokenPayload["role"][]
): boolean {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return roles.includes(payload.role);
}

/**
 * Check if doctor can access appointment
 * 
 * @param payload - Token payload (must be DOCTOR role)
 * @param doctorId - Doctor ID from database
 * @returns true if token matches doctor
 */
export function canAccessAsDoctor(payload: TokenPayload, doctorId: string): boolean {
  if (payload.role !== "DOCTOR") return false;
  return payload.doctorId === doctorId;
}

/**
 * Check if user can access clinic
 * 
 * @param payload - Token payload
 * @param clinicId - Clinic ID
 * @returns true if user has clinic access
 */
export function canAccessClinic(payload: TokenPayload, clinicId: string): boolean {
  if (payload.role === "ADMIN") return true; // ADMIN can access all clinics
  if (payload.role === "CLINIC_OWNER") return payload.clinicId === clinicId;
  if (payload.role === "RECEPTIONIST") return payload.clinicId === clinicId;
  return false;
}
