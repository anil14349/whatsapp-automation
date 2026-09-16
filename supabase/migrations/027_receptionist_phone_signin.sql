-- A receptionist should not need an email address.
--
-- A doctor signs in with their WhatsApp number, and a receptionist was made to
-- have an email for no reason beyond how the login was first written. Front
-- desk staff generally have a phone; a work address is the rarer thing.
--
-- The column stays, because a receptionist who has one should still be able to
-- use it. It simply is not required any more.

ALTER TABLE receptionists
    ALTER COLUMN email DROP NOT NULL;

DO $$
BEGIN
    ALTER TABLE receptionists
        ADD CONSTRAINT receptionists_reachable
        -- One or the other has to exist: it is both how they sign in and where
        -- their password is sent, so neither can be missing.
        CHECK (email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- Signing in by number looks the row up by number, so two people at one clinic
-- sharing one would match neither. Refused here as well as in the code, since
-- the code is the thing that can be wrong.
CREATE UNIQUE INDEX IF NOT EXISTS receptionists_phone_unique
    ON receptionists (clinic_id, phone)
    WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS doctors_phone_unique
    ON doctors (clinic_id, phone)
    WHERE phone IS NOT NULL;
