-- ============================================================
-- ABC Clinic — initial schema
-- Ports every Google Sheet from the Apps Script bot (../../src) into
-- Postgres tables. Column comments cross-reference the original sheet
-- column so the port is auditable against the legacy system.
-- ============================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ------------------------------------------------------------------
-- doctors  (was: Doctors sheet)
-- ------------------------------------------------------------------
create table doctors (
    id                     uuid primary key default gen_random_uuid(),
    doctor_code            text not null unique, -- was "Doctor ID", e.g. D001, kept for continuity with existing appointment records/URLs
    name                   text not null,
    clinic_name            text not null default '',
    calendar_id            text not null default '', -- Google Calendar ID; blank = no calendar sync for this doctor
    whatsapp_phone         text not null default '', -- doctor's own WhatsApp number, used to route inbound messages to the doctor flow
    appointment_duration_minutes integer not null default 30,
    active                 boolean not null default true, -- was "Active" = YES/NO; gates doctor-portal login
    specialization         text not null default '',
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create unique index doctors_whatsapp_phone_idx
    on doctors (whatsapp_phone)
    where whatsapp_phone <> '';

comment on table doctors is 'One row per doctor. Was the Doctors sheet.';

-- ------------------------------------------------------------------
-- doctor_availability  (was: Availability sheet)
-- ------------------------------------------------------------------
create type weekday as enum (
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
);

create table doctor_availability (
    id           uuid primary key default gen_random_uuid(),
    doctor_id    uuid not null references doctors(id) on delete cascade,
    day_of_week  weekday not null,
    start_time   time not null, -- was "Start" e.g. "09:00 AM" — stored as a real TIME now
    end_time     time not null, -- was "End"
    created_at   timestamptz not null default now(),

    constraint availability_start_before_end check (start_time < end_time)
);

create index doctor_availability_doctor_idx on doctor_availability (doctor_id, day_of_week);

comment on table doctor_availability is 'Weekly recurring hours per doctor. Was the Availability sheet. A doctor can have multiple rows per day (e.g. morning + evening sessions).';

-- ------------------------------------------------------------------
-- doctor_leaves  (was: Doctor_Leaves sheet)
-- ------------------------------------------------------------------
create table doctor_leaves (
    id         uuid primary key default gen_random_uuid(),
    doctor_id  uuid not null references doctors(id) on delete cascade,
    leave_date date not null,
    reason     text not null default '',
    active     boolean not null default true, -- was "Active" TRUE/FALSE — inactive leaves stay for history but no longer block booking
    created_at timestamptz not null default now()
);

create unique index doctor_leaves_doctor_date_idx on doctor_leaves (doctor_id, leave_date);

comment on table doctor_leaves is 'Was the Doctor_Leaves sheet. Active=false rows are cancelled leaves kept for audit history.';

-- ------------------------------------------------------------------
-- patients  (was: Patients sheet)
-- ------------------------------------------------------------------
create table patients (
    id            uuid primary key default gen_random_uuid(),
    patient_code  text not null unique, -- was "Patient ID" (PAT-YYYYMMDD-nnnn style)
    phone         text not null unique,
    name          text not null default '',
    language      text not null default 'EN', -- EN | TE | HI | KA | TA | ML
    notes         text not null default '', -- was "Notes"
    first_seen_at timestamptz not null default now(), -- was "First Seen"
    last_visit_at timestamptz, -- was "Last Visit"
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on table patients is 'Was the Patients sheet. phone is the natural key patients are looked up by from WhatsApp.';

-- ------------------------------------------------------------------
-- appointment_status enum + appointments  (was: Appointments sheet)
-- ------------------------------------------------------------------
create type appointment_status as enum (
    'Confirmed', 'Cancelled', 'Completed', 'No-Show'
);

create table appointments (
    id                  uuid primary key default gen_random_uuid(),
    appointment_code    text not null unique, -- was "Appointment ID" — kept as a short human-readable code shown to patients/doctors
    doctor_id           uuid not null references doctors(id),
    patient_id          uuid references patients(id), -- nullable: a booking can arrive before the patient record is fully set up
    patient_name        text not null, -- denormalized snapshot at booking time (name can change later without rewriting history)
    patient_phone       text not null,
    appointment_date    date not null,
    appointment_time    time not null,
    status              appointment_status not null default 'Confirmed',
    calendar_event_id   text not null default '', -- Google Calendar event ID, blank if Calendar integration is off for this doctor
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index appointments_doctor_date_idx on appointments (doctor_id, appointment_date, appointment_time);
create index appointments_patient_phone_idx on appointments (patient_phone);
create index appointments_status_idx on appointments (status);

comment on table appointments is 'Was the Appointments sheet. One row per booking.';

-- ------------------------------------------------------------------
-- whatsapp_sessions  (was: WhatsApp_Sessions sheet)
-- Conversation state machine persistence — one row per phone number.
-- ------------------------------------------------------------------
create table whatsapp_sessions (
    phone             text primary key, -- was "Phone"
    role              text not null default '', -- "PATIENT" | "DOCTOR"
    state             text not null default '', -- current conversation state, e.g. "MAIN_MENU", "BOOK_DATE"
    doctor_id         uuid references doctors(id),
    session_date      text not null default '', -- free-form during multi-step flows, not always a valid ISO date yet
    session_time      text not null default '',
    appointment_id    uuid references appointments(id),
    language          text not null default 'EN',
    patient_name      text not null default '',
    slot_page         integer not null default 0, -- pagination state for the time-slot picker
    appointment_page  integer not null default 0, -- pagination state for appointment-list menus
    doctor_menu_tier  text not null default '', -- which "More" tier of the doctor portal menu is showing
    list_page         integer not null default 0, -- generic pagination state (doctor selection, session-remove lists)
    location          text not null default '', -- "lat,lng" captured from a WhatsApp location share (home collection flow)
    updated_at        timestamptz not null default now()
);

comment on table whatsapp_sessions is 'Was the WhatsApp_Sessions sheet. One row per phone number, holds the in-progress conversation state.';

-- ------------------------------------------------------------------
-- home_collection_requests  (was: Home_Collection_Requests sheet)
-- ------------------------------------------------------------------
create table home_collection_requests (
    id                  uuid primary key default gen_random_uuid(),
    request_code        text not null unique, -- was "Request ID"
    phone               text not null,
    patient_name        text not null default '',
    latitude            double precision not null,
    longitude           double precision not null,
    distance_km         numeric(6, 2) not null,
    preferred_date      date not null,
    time_window         text not null default '', -- e.g. "Morning (8-11 AM)"
    status              text not null default 'Requested',
    created_at          timestamptz not null default now()
);

comment on table home_collection_requests is 'Was the Home_Collection_Requests sheet. Home blood-sample-collection requests, location-gated by HOME_COLLECTION_RADIUS_KM.';

-- ------------------------------------------------------------------
-- message_log  (was: WhatsApp_Log sheet — inbound/outbound/reminder ledger)
-- ------------------------------------------------------------------
create table message_log (
    id                uuid primary key default gen_random_uuid(),
    logged_at         timestamptz not null default now(), -- was "Timestamp"
    direction         text not null, -- "IN" | "OUT" | "REMINDER"
    phone             text not null default '',
    patient_name      text not null default '', -- was "Name"
    status            text not null default '', -- e.g. "SUCCESS", "FAILED", "SKIPPED"
    message           text not null default '',
    appointment_id    uuid references appointments(id),
    hours_before       numeric(6, 2), -- reminder lead time, only set for direction = REMINDER
    phone_number_id   text not null default '' -- which WhatsApp Business phone number sent/received this (multi-number support)
);

create index message_log_phone_idx on message_log (phone, logged_at desc);
create index message_log_direction_idx on message_log (direction, logged_at desc);
-- Dedup lookup used by the reminder job: "has this appointment+lead-time
-- reminder already been sent?"
create index message_log_reminder_dedup_idx
    on message_log (appointment_id, hours_before)
    where direction = 'REMINDER';

comment on table message_log is 'Was the WhatsApp_Log sheet (consolidated inbound/outbound/reminder ledger). Retention cleanup is a scheduled job, not a sheet-size cap.';

-- ------------------------------------------------------------------
-- settings  (was: Settings sheet, key/value)
-- Configurable options surfaced in the admin UI's Settings page.
-- ------------------------------------------------------------------
create table settings (
    key         text primary key,
    value       text not null,
    updated_at  timestamptz not null default now()
);

comment on table settings is 'Was the Settings sheet. Key/value config read by both the WhatsApp bot and the admin UI''s Settings page.';

insert into settings (key, value) values
    ('CLINIC_NAME', 'ABC Clinic'),
    ('LOG_RETENTION', 'month'),
    ('LOG_MAX_ROWS', '5000'),
    ('LOG_MESSAGE_MAX_CHARS', '500'),
    ('ENABLE_INBOUND_LOG', 'TRUE'),
    ('ENABLE_DEBUG_LOG', 'TRUE'),
    ('ENABLE_APPOINTMENT_REMINDERS', 'TRUE'),
    ('REMINDER_HOURS_BEFORE', '24'),
    ('REMINDER_WINDOW_MINUTES', '45'),
    ('ENABLE_INTERACTIVE_MENUS', 'TRUE'),
    ('AUTO_COMPLETE_PAST_APPOINTMENTS', 'FALSE'),
    ('AUTO_COMPLETE_HOURS_AFTER', '4'),
    ('ENABLE_AFTER_HOURS_REPLY', 'FALSE'),
    ('CLINIC_OPEN_TIME', '09:00'),
    ('CLINIC_CLOSE_TIME', '18:00'),
    ('CLINIC_WORKING_DAYS', 'Mon,Tue,Wed,Thu,Fri,Sat'),
    ('AFTER_HOURS_MESSAGE', ''),
    ('HOSPITAL_LATITUDE', ''),
    ('HOSPITAL_LONGITUDE', ''),
    ('HOME_COLLECTION_RADIUS_KM', '5');

-- ------------------------------------------------------------------
-- admin_users  (new — did not exist in the Apps Script version, which
-- had no receptionist/admin UI; needed now for login to that UI)
-- ------------------------------------------------------------------
create type admin_role as enum ('ADMIN', 'RECEPTIONIST');

create table admin_users (
    id             uuid primary key default gen_random_uuid(),
    email          text not null unique,
    password_hash  text not null,
    full_name      text not null default '',
    role           admin_role not null default 'RECEPTIONIST',
    active         boolean not null default true,
    created_at     timestamptz not null default now()
);

comment on table admin_users is 'Receptionist/admin login for the new web UI. Not present in the Apps Script version — the WhatsApp doctor portal was the only "admin" surface before this rewrite.';

-- ------------------------------------------------------------------
-- updated_at auto-touch trigger, applied to every table that has one
-- ------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger doctors_set_updated_at
    before update on doctors
    for each row execute function set_updated_at();

create trigger patients_set_updated_at
    before update on patients
    for each row execute function set_updated_at();

create trigger appointments_set_updated_at
    before update on appointments
    for each row execute function set_updated_at();

create trigger settings_set_updated_at
    before update on settings
    for each row execute function set_updated_at();
