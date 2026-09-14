-- Clinic opening hours and the after-hours auto-reply gate.
-- getClinicConfig() expected these columns but they never existed, so every
-- clinic silently used the hardcoded 09:00-18:00 Mon-Sat fallback.

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS open_time VARCHAR(5) DEFAULT '09:00',
    ADD COLUMN IF NOT EXISTS close_time VARCHAR(5) DEFAULT '18:00',
    ADD COLUMN IF NOT EXISTS working_days VARCHAR(64) DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat',
    ADD COLUMN IF NOT EXISTS enable_after_hours_reply BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS after_hours_message TEXT;

COMMENT ON COLUMN clinics.open_time IS 'Opening time HH:MM in the clinic timezone';
COMMENT ON COLUMN clinics.close_time IS 'Closing time HH:MM in the clinic timezone';
COMMENT ON COLUMN clinics.working_days IS 'Comma-separated short day names, e.g. Mon,Tue,Wed';
COMMENT ON COLUMN clinics.enable_after_hours_reply IS 'When true, new patient conversations outside hours get an auto-reply instead of the menu';
COMMENT ON COLUMN clinics.after_hours_message IS 'Optional override for the default after-hours text';
