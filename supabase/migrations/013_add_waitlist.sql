-- Waitlist for fully booked slots.
-- Columns match the expectations of shared/handlers/waitlist-handler.ts.

CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    time VARCHAR(5) NOT NULL,
    position INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    notified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT waitlist_status_check CHECK (status IN ('PENDING', 'NOTIFIED', 'BOOKED', 'CANCELLED', 'EXPIRED'))
);

-- Lookup path used when offering a slot and when notifying after a cancellation.
CREATE INDEX IF NOT EXISTS idx_waitlist_slot
    ON waitlist (clinic_id, doctor_id, date, time, status);

CREATE INDEX IF NOT EXISTS idx_waitlist_phone
    ON waitlist (phone, status);

-- One pending entry per patient per slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_unique_pending
    ON waitlist (clinic_id, phone, doctor_id, date, time)
    WHERE status = 'PENDING';

GRANT ALL ON waitlist TO service_role;
