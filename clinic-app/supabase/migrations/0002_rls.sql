-- ============================================================
-- Row Level Security
--
-- Every read/write in this app goes through a Next.js API route using
-- the Supabase SERVICE ROLE key (see lib/supabase/server.ts), which
-- bypasses RLS by design. The browser never talks to Supabase directly
-- with the anon key for these tables. So: enable RLS everywhere and add
-- NO policies for the anon/authenticated roles — this is a default-deny
-- posture that only the service role can get through, closing off any
-- accidental direct-from-browser access if a future page is written
-- carelessly.
-- ============================================================

alter table doctors enable row level security;
alter table doctor_availability enable row level security;
alter table doctor_leaves enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table whatsapp_sessions enable row level security;
alter table home_collection_requests enable row level security;
alter table message_log enable row level security;
alter table settings enable row level security;
alter table admin_users enable row level security;
