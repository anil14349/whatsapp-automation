import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";

/**
 * Shared auth check for the scheduled-job routes under app/api/cron/*.
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * for scheduled invocations (see vercel.json) — this is also usable from
 * any other scheduler (cron-job.org, GitHub Actions, etc.) that can set
 * a header, which matters since this project isn't committed to Vercel
 * specifically (see README's Docker/multi-hospital deployment options).
 *
 * Constant-time comparison, same reasoning as lib/auth/session.ts's
 * session cookie check — an unconfigured CRON_SECRET can never match
 * any request (fail-closed), same pattern as
 * WHATSAPP_WEBHOOK_POST_TOKEN.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const env = getServerEnv();

  if (!env.CRON_SECRET) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;

  const headerBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);

  return headerBuffer.length === expectedBuffer.length && timingSafeEqual(headerBuffer, expectedBuffer);
}
