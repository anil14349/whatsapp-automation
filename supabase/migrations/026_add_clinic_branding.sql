-- A clinic should look like itself.
--
-- The portal is the same shade of slate for everyone, and a clinic that hands
-- this to its own staff is handing them somebody else's software. Two columns
-- carry the whole difference: a logo and a colour.
--
-- Both are optional. A clinic that sets neither keeps the current look rather
-- than getting a broken image and an unreadable button.

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS brand_colour TEXT;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_brand_colour_is_hex
        -- Anything else reaches the browser as a style attribute, so this is
        -- also what stops a colour field being used to inject one.
        CHECK (brand_colour IS NULL OR brand_colour ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_logo_url_is_http
        -- Same reasoning: a logo url ends up in an img src, and javascript: or
        -- data: there is a script, not a picture.
        CHECK (logo_url IS NULL OR logo_url ~* '^https?://');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;
