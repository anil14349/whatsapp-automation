-- ============================================================
-- Grant service_role access to application tables
-- ============================================================
-- Edge Functions authenticate as service_role. The earlier migrations
-- created these tables without Supabase's usual default privileges, so
-- every query returned "42501: permission denied". Sessions, message
-- logging and appointment writes all failed silently as a result.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Apply the same grants to tables added by future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO service_role;
