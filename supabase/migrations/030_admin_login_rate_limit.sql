-- Let an admin be locked out too.
--
-- Doctors and receptionists lock for fifteen minutes after three failed
-- attempts. Admins did not, because they could not: user_type is constrained
-- to doctor and receptionist, so recording a failed admin attempt violated a
-- check constraint and was discarded. The account that creates staff, changes
-- every setting and reads the clinic's figures was the only one a password
-- could be guessed at indefinitely.
--
-- Found by trying to lock a test admin out and signing in immediately
-- afterwards.

ALTER TABLE login_rate_limits
    DROP CONSTRAINT IF EXISTS login_rate_limits_user_type_check;

ALTER TABLE login_rate_limits
    ADD CONSTRAINT login_rate_limits_user_type_check
    CHECK (user_type IN ('doctor', 'receptionist', 'admin'));

-- A platform admin belongs to no clinic, so the column cannot stay NOT NULL
-- without inventing one for them.
ALTER TABLE login_rate_limits
    ALTER COLUMN clinic_id DROP NOT NULL;

-- The old uniqueness was (user_id, user_type, clinic_id). Postgres treats
-- NULLs as distinct in a unique constraint, so with a null clinic that stops
-- constraining anything: a platform admin could accumulate a fresh row per
-- failed attempt, and the counter would never pass one.
--
-- A person is one type and one id, so the clinic adds nothing to identity.
DELETE FROM login_rate_limits a
USING login_rate_limits b
WHERE a.user_id = b.user_id
  AND a.user_type = b.user_type
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS login_rate_limits_user_unique
    ON login_rate_limits (user_id, user_type);

COMMENT ON COLUMN login_rate_limits.clinic_id IS
    'The clinic the account belongs to. NULL for a platform admin, who has none.';
