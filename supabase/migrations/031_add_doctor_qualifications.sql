-- What a doctor is qualified in, and what they look like.
--
-- A patient choosing between names on a phone has nothing to choose on. The
-- list shows a name, a specialisation and whether they are free; it does not
-- show that the doctor holds an MD, which is exactly what a patient weighs up
-- when picking someone to see about their child.
--
-- `license_number` and `years_experience` already exist and nothing reads
-- either. Neither is what a patient wants: a licence number is a regulator's
-- concern, and years of experience is a number the clinic would have to keep
-- accurate forever. Qualifications are written once and stay true.

ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS qualifications VARCHAR(160);

ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS photo_url TEXT;

DO $$
BEGIN
    ALTER TABLE doctors
        ADD CONSTRAINT doctors_photo_url_is_http
        -- This ends up in an img src, so javascript: or data: there is a
        -- script rather than a photograph. Same rule as the clinic logo.
        CHECK (photo_url IS NULL OR photo_url ~* '^https?://');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN doctors.qualifications IS
    'As the doctor would write them, e.g. "MBBS, MD (General Medicine)". Shown to patients.';
COMMENT ON COLUMN doctors.photo_url IS
    'Optional. Where none is set the portal shows the doctor''s initials rather than a stock face.';
