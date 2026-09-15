-- Let a clinic name a shared service the way its patients would say it.
--
-- A clinic can rename services it added, but the five shared ones are used by
-- every clinic, so renaming one there would rename it for all of them. A clinic
-- that calls a consultation "OP Consultation" had no way to say so.
--
-- NULL keeps the catalogue name. Anything else is what this clinic's patients
-- see, and only theirs.

ALTER TABLE clinic_services
    ADD COLUMN IF NOT EXISTS display_name TEXT;

DO $$
BEGIN
    ALTER TABLE clinic_services
        ADD CONSTRAINT clinic_services_display_name_fits
        -- A WhatsApp list row truncates at 24 characters, so a longer name
        -- would be cut off on the patient's phone rather than wrapped.
        CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 24);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;
