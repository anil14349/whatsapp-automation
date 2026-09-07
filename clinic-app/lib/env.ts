import { z } from "zod";

/**
 * Validated, typed access to environment variables. Import `env` instead
 * of reading `process.env` directly anywhere else in the codebase, so a
 * missing/misconfigured variable fails loudly at the point of use with a
 * clear message instead of surfacing as a confusing runtime error deep
 * inside Supabase/WhatsApp/Calendar client code.
 */

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_WEBHOOK_POST_TOKEN: z.string().min(1),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional().or(z.literal("")),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional().or(z.literal("")),

  ADMIN_SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),

  CLINIC_TIMEZONE: z.string().default("Asia/Kolkata")
});

type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Reads and validates all server-side env vars. Call this from server-only
 * code (API routes, server components, scripts) — never from a "use
 * client" component, since several of these are secrets.
 */
export function getServerEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      "Invalid/missing environment variables:\n" +
        issues +
        "\n\nCopy .env.example to .env.local and fill in real values."
    );
  }

  cached = parsed.data;
  return cached;
}
