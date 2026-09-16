-- Where the clinic is, and how far it will travel.
--
-- Home collection has been accepting a location pin dropped anywhere on earth.
-- The patient shares a pin, the request is created, and a collector finds out
-- it is a two hour drive when they open it. Nothing in the code has ever
-- measured the distance, because there was nothing to measure it from: the
-- clinics table has no coordinates.
--
-- `doctor_service_zones` already carries center_latitude/center_longitude/
-- service_radius_km, but it is per doctor, has never had a row written to it,
-- and home collection is not a doctor activity. The clinic itself is the
-- origin for a sample collection, so the columns belong here.
--
-- All three are optional. A clinic that sets none keeps today's behaviour of
-- accepting every location, because refusing patients on the basis of a
-- distance we cannot calculate would be worse than not checking.

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8);

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS home_collection_radius_km NUMERIC(5, 1);

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_latitude_range
        CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_longitude_range
        CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_home_collection_radius_range
        -- 200 km is already far past anything a sample stays viable for; the
        -- upper bound is here to catch a metres-vs-kilometres mix-up.
        CHECK (
            home_collection_radius_km IS NULL
            OR (home_collection_radius_km > 0 AND home_collection_radius_km <= 200)
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_coordinates_are_a_pair
        -- One without the other cannot locate anything, and a half-filled pair
        -- would read as "configured" to the distance check.
        CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR (latitude IS NOT NULL AND longitude IS NOT NULL)
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN clinics.latitude IS
    'Clinic location, used as the origin for home collection distance checks.';
COMMENT ON COLUMN clinics.home_collection_radius_km IS
    'How far the clinic will travel for a home collection. NULL means no limit is enforced.';
