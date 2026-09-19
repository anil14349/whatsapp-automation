-- When a doctor is not seeing patients, but the day is not off.
--
-- Until now the only way to say this was availability_status = ON_BREAK, which
-- hides every slot for the whole day. A doctor who eats lunch between one and
-- two had no way to express it, so patients were offered 13:00 and turned up
-- to a closed door.
--
-- Two kinds live here because they are the same thing to the slot builder and
-- only differ in when they recur:
--
--   day_of_week  a standing break -- lunch, dinner -- entered per weekday, so
--                a short Saturday can differ from a Tuesday
--   on_date      one unplanned break on one day
--
-- Exactly one is set, which the check below enforces rather than trusting the
-- caller. A row with both would be read twice by the slot builder; a row with
-- neither would never be read at all and would look like a break that does
-- nothing.

CREATE TABLE IF NOT EXISTS doctor_breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,

    -- 1 = Monday through 7 = Sunday, matching doctor_operating_hours.
    day_of_week INT,
    on_date DATE,

    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    reason TEXT,

    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT doctor_breaks_one_kind
        CHECK ((day_of_week IS NULL) <> (on_date IS NULL)),
    CONSTRAINT doctor_breaks_valid_day
        CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 1 AND 7)),
    -- Zero-padded HH:MM compares correctly as text, which is also why the
    -- surrounding columns are varchar(5) rather than time.
    CONSTRAINT doctor_breaks_ends_after_start
        CHECK (end_time > start_time)
);

-- The slot builder asks for one doctor's breaks on one day, and asks on every
-- booking, so both shapes are indexed.
CREATE INDEX IF NOT EXISTS idx_doctor_breaks_recurring
    ON doctor_breaks (clinic_id, doctor_id, day_of_week)
    WHERE day_of_week IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_breaks_dated
    ON doctor_breaks (clinic_id, doctor_id, on_date)
    WHERE on_date IS NOT NULL;

ALTER TABLE doctor_breaks ENABLE ROW LEVEL SECURITY;

-- Matches the read policy the other doctor tables use: the service role does
-- the work, and nothing reaches this table from a browser.
DROP POLICY IF EXISTS doctor_breaks_service ON doctor_breaks;
CREATE POLICY doctor_breaks_service ON doctor_breaks
    FOR ALL USING (auth.role() = 'service_role');
