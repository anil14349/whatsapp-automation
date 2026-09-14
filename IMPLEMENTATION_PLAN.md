# Complete WhatsApp Flow Implementation Plan

## Phase 1: Core Booking Flow (CRITICAL)

### Patient Handler - Booking States
- [x] LANGUAGE_SELECT - Uses button IDs (lang_en, lang_te, etc.)
- [x] MAIN_MENU - Uses button IDs (menu_book, menu_appointments, etc.)
- [ ] BOOK_LOCATION_TYPE - NEW: Choose Clinic Visit vs Home Visit
  - Buttons: loc_clinic, loc_home
  - Store: session.data.locationType
  
- [ ] BOOK_DOCTOR - Show doctors as list menu
  - Parse: buttonId or slot number
  - Query: this.supabaseClient.getDoctors(clinicId)
  - Store: session.data.selectedDoctorId, selectedDoctorName, selectedDoctorPhone
  
- [ ] BOOK_DATE - Show 3 button options (Today, Tomorrow, Other)
  - Buttons: date_today, date_tomorrow, date_other
  - If other: accept YYYY-MM-DD free text
  - Query: Check availability for that date
  - Store: session.data.selectedDate
  
- [ ] BOOK_TIME - Show available time slots as list menu (paginated)
  - Query: this.supabaseClient.getAvailableSlots(clinicId, doctorId, date, locationType)
  - Buttons: slot numbers or time IDs
  - Pagination: nav_more, nav_earlier
  - Store: session.data.selectedTime
  
- [ ] BOOK_NAME - Collect patient name (free text)
  - Validate: 2-100 characters
  - Auto-fill: if in patient registry
  - Store: session.data.patientName
  
- [ ] BOOK_CONFIRM - Confirm booking with buttons
  - Buttons: confirm_yes, confirm_no
  - Call: this.supabaseClient.createAppointment()
  - Transition: MAIN_MENU on success
  - Store: session.data.lastAppointmentId

### Patient Handler - Appointment Management
- [ ] MY_APPOINTMENTS - List patient's upcoming appointments
  - Query: this.supabaseClient.getPatientAppointments(clinicId, phone)
  - Pagination: if > 9 items
  - Buttons: appointment IDs for selection
  
- [ ] CANCEL_SELECT - Pick appointment to cancel
  - Show: MY_APPOINTMENTS list
  - Parse: appointment ID button
  - Store: session.data.selectedAppointmentId
  
- [ ] CANCEL_CONFIRM - Confirm cancellation
  - Buttons: confirm_yes, confirm_no
  - Call: this.supabaseClient.cancelAppointment()
  - Notify: Doctor via WhatsApp
  - Transition: MAIN_MENU
  
- [ ] RESCHEDULE_SELECT - Pick appointment to reschedule
  - Show: MY_APPOINTMENTS list
  - Parse: appointment ID button
  - Store: session.data.selectedAppointmentId
  
- [ ] RESCHEDULE_DATE - Pick new date (Today/Tomorrow/Other)
  - Same as BOOK_DATE
  - Store: session.data.rescheduledDate
  
- [ ] RESCHEDULE_TIME - Pick new time
  - Same as BOOK_TIME
  - Store: session.data.rescheduledTime
  
- [ ] RESCHEDULE_CONFIRM - Confirm rescheduling
  - Buttons: confirm_yes, confirm_no
  - Call: this.supabaseClient.rescheduleAppointment()
  - Notify: Doctor via WhatsApp
  - Transition: MAIN_MENU

## Phase 2: Doctor Portal (CRITICAL)

### Doctor Handler - All 8 States
- [ ] DOCTOR_LOGIN - Accept PIN as free text
  - Validate: against DOCTOR_PORTAL_PIN env var
  - Lookup: doctor by phone
  - Transition: DOCTOR_MENU
  
- [ ] DOCTOR_MENU - Show doctor portal options (buttons)
  - Buttons: doctor_availability, doctor_leave, doctor_appointments, doctor_cancel
  - Parse: button ID
  
- [ ] DOCTOR_AVAILABILITY - Accept time range (HH:MM-HH:MM)
  - Free text input
  - Validate: time format
  - Transition: DOCTOR_AVAILABILITY_CONFIRM
  
- [ ] DOCTOR_AVAILABILITY_CONFIRM - Confirm availability
  - Buttons: confirm_yes, confirm_no
  - Call: this.supabaseClient.addDoctorOperatingHours()
  - Transition: DOCTOR_MENU
  
- [ ] DOCTOR_LEAVE - Accept leave dates
  - Free text: YYYY-MM-DD or YYYY-MM-DD to YYYY-MM-DD
  - Transition: DOCTOR_LEAVE_CONFIRM
  
- [ ] DOCTOR_LEAVE_CONFIRM - Confirm leave
  - Buttons: confirm_yes, confirm_no
  - Call: this.supabaseClient.addDoctorLeave()
  - Transition: DOCTOR_MENU
  
- [ ] DOCTOR_APPOINTMENTS - Show today's appointments
  - Query: this.supabaseClient.getAppointmentsByDoctor(clinicId, doctorId, today)
  - Allow: selection to see details or mark status
  
- [ ] DOCTOR_CANCEL - Logout (already good)
  - Transition: DOCTOR_LOGIN

## Phase 3: Home Collection (IMPORTANT)

### Home Collection Handler - 4 States
- [ ] LOCATION_SELECT - Request location from patient
  - Prompt: "Send your WhatsApp location"
  - Accept: WhatsAppMessage.location field
  - Validate: Haversine distance < HOME_COLLECTION_RADIUS_KM
  
- [ ] LOCATION_VERIFY - Show location & ask confirmation
  - Display: "Distance: X km from clinic"
  - Buttons: confirm_yes, confirm_no
  - Store: session.data.location, distance
  
- [ ] REQUEST_CONFIRM - Pick time window
  - Buttons: time_morning, time_afternoon, time_evening
  - Also: date_today, date_tomorrow, date_other
  - Store: session.data.requestDate, requestTimeWindow
  
- [ ] REQUEST_TRACKING - Show tracking info
  - Query: this.supabaseClient.getHomeCollectionRequest()
  - Display: Status (PENDING, ASSIGNED, ON_THE_WAY, COMPLETED)
  - Update: real-time if tracking available

## Phase 4: Advanced Features (AFTER PHASES 1-3)

### Appointment Reminders
- [ ] Schedule reminders 24 hours before appointment
- [ ] Localize reminders for all 6 languages
- [ ] Dedup via reminder ledger
- [ ] Configurable from Settings

### After-Hours Handling
- [ ] Check clinic hours on every inbound patient message
- [ ] Auto-reply with after-hours message
- [ ] Bypass for doctors
- [ ] Bypass for patients mid-booking

### Doctor Status Marking
- [ ] DOCTOR_STATUS_SELECT - Show completed appointments only
- [ ] DOCTOR_STATUS_CONFIRM - Mark as Completed or No-Show
- [ ] Hide marked appointments from future views

### List Pagination
- [ ] Track page number in session
- [ ] Show "More times" / "Earlier times" buttons
- [ ] Slice results (9 items per page)
- [ ] Support typed numbers as fallback

### Doctor Notifications
- [ ] When patient cancels: notify doctor
- [ ] When patient reschedules: notify doctor
- [ ] When patient books: notify doctor (optional)
- [ ] Localize notifications

### Home Visit Feature
- [ ] Store locationType in appointments
- [ ] Query doctor_home_visit_hours instead of operating_hours
- [ ] Check doctor_service_zones for availability
- [ ] Premium pricing for home visits
- [ ] Show home visit services in BOOK_SERVICE state

## Implementation Order

1. **Phase 1 First**: Get core booking working end-to-end
   - Need: Working date/time selection
   - Need: Working confirmation with button IDs
   - Need: Proper Supabase calls

2. **Phase 2 Second**: Get doctor portal working
   - Doctors need to be able to manage availability

3. **Phase 3 Third**: Home collection
   - Less critical but needed for complete feature set

4. **Phase 4 Last**: Nice-to-haves
   - Reminders, after-hours, status marking

## Testing Strategy

For each state:
1. Unit test the button ID parsing
2. Integration test with Supabase
3. End-to-end test the full flow

Use mock Supabase responses initially if needed.
