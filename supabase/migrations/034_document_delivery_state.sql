-- A document is not delivered just because Meta accepted it.
--
-- The portal marked a report SENT as soon as the send call returned a message
-- id, and showed the desk "sent". Meta reports the real outcome afterwards, on
-- the status webhook - a number outside the tester list, or one that has not
-- messaged us in 24 hours, fails there. So the desk was told the patient had
-- their report when nothing had arrived.
--
-- SENT now means "handed to WhatsApp" and DELIVERED means Meta confirmed it.

DO $$
BEGIN
    ALTER TABLE patient_documents DROP CONSTRAINT patient_documents_status_known;
EXCEPTION
    WHEN undefined_object THEN NULL;
END;
$$;

ALTER TABLE patient_documents
    ADD CONSTRAINT patient_documents_status_known
    CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED'));

-- The status webhook arrives with Meta's message id and nothing else to match
-- on, and it arrives for every message the clinic sends, not just documents.
CREATE INDEX IF NOT EXISTS patient_documents_by_message
    ON patient_documents (message_id)
    WHERE message_id IS NOT NULL;
