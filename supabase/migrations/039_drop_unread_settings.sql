-- Two settings that were never read.
--
-- FEEDBACK_SAMPLING_RATE says three patients in ten are surveyed. All ten are:
-- nothing loads the value. COST_OPTIMIZATION_SKIP_24H_REMINDER says the
-- 24-hour reminder can be switched off to save API calls. It cannot; the
-- scheduler does not look.
--
-- Both are worse than missing. Someone reading app_settings to answer "why did
-- this patient get a survey" finds a rate that explains it, and the
-- explanation is wrong. HOME_COLLECTION_MIN_LEAD_HOURS was the same shape and
-- was deleted rather than implemented, for the same reason.
--
-- Deleted rather than honoured because sampling is a decision about how often
-- to contact patients, and nobody has made it. If it is wanted later it should
-- arrive with the code that reads it.

DELETE FROM app_settings
WHERE key IN ('FEEDBACK_SAMPLING_RATE', 'COST_OPTIMIZATION_SKIP_24H_REMINDER');
