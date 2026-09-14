# Doctor Home Visits Feature

**Date:** September 14, 2026  
**Status:** Schema Design Complete - Ready for Implementation  

---

## 🚗 Overview

Enable doctors to provide consultations, vaccines, and other services at patient homes with:
- Separate availability schedules for home visits (can differ from clinic hours)
- Geographic zone management (define service radius for each doctor)
- Real-time tracking (arrival/departure times, travel optimization)
- Service-specific pricing (home visits can cost more than clinic)
- Automatic route optimization (minimize travel time between visits)
- Patient notifications (doctor arriving in 15 minutes)

---

## 🗂️ New Tables (4 Total)

### 1. **doctor_services**
Links each doctor to services they can provide, with home/clinic capabilities:

```sql
doctor_id → service_type_id
  - is_enabled: true/false
  - can_do_clinic_visit: true (consultations, vaccines)
  - can_do_home_visit: true (vaccines, some consultations)
  - clinic_price: ₹500 (at clinic)
  - home_visit_price: ₹750 (higher, for convenience)
```

**Example:**
```
Dr. Smith:
  - Consultation: clinic ✅, home ✅ (₹500 / ₹750)
  - Vaccine: clinic ✅, home ✅ (₹300 / ₹450)
  
Dr. Jones:
  - Consultation: clinic ✅, home ❌ (clinic only)
  - Blood Test: clinic ✅, home ✅ (₹200 / ₹300)
```

### 2. **doctor_home_visit_hours**
Defines when each doctor is available for home visits (separate from clinic hours):

```sql
doctor_id + day_of_week (1=Monday, 7=Sunday)
  - opening_time: "10:00" (may differ from clinic 09:00)
  - closing_time: "19:00" (extended hours for home visits)
  - min_travel_time_minutes: 15 (between appointments)
  - buffer_after_appointment_minutes: 10 (prep time)
  - max_home_visits_per_day: 8 (cap on visits)
```

**Example:**
```
Dr. Smith:
  - Mon-Fri: 10:00-19:00 (home visits only, clinic is 9:00-18:00)
  - Sat-Sun: OFF

Dr. Jones:
  - Mon-Sun: 06:00-21:00 (available 24/6 for emergency home visits)
  - Max 10 visits/day
```

### 3. **doctor_service_zones**
Defines geographic areas each doctor can serve for home visits:

```sql
doctor_id + zone_name
  - zone_code: "NORTH_DELHI"
  - center_latitude, center_longitude: GPS center
  - service_radius_km: 5 (doctor serves within 5km radius)
  - postal_codes: "110001,110002,110003" (alternative: just postal codes)
```

**Example:**
```
Dr. Smith serves:
  - North Delhi (radius 5km from clinic)
  - East Delhi (radius 5km from clinic)

Dr. Jones serves:
  - South Delhi (radius 8km, more experienced with longer drives)
  - West Delhi (radius 5km)
```

### 4. **doctor_home_visit_schedules**
Tracks actual home visit appointments with real-time data:

```sql
appointment_id + doctor_id
  - scheduled_visit_order: 1, 2, 3 (1st, 2nd, 3rd home visit today)
  - estimated_arrival_time: TIMESTAMP
  - estimated_departure_time: TIMESTAMP
  - actual_arrival_time: TIMESTAMP (updated when doctor arrives)
  - actual_departure_time: TIMESTAMP (updated when doctor leaves)
  - visit_distance_km: 2.5 (from previous location)
  - visit_travel_time_minutes: 12 (actual vs estimated)
  - visit_notes: "Vaccine administered, no adverse reactions"
  - doctor_arrived_notification_sent: true/false
```

### 5. **Updated: appointments**
Added home visit tracking fields:

```sql
- location_type: "HOME" (new value alongside CLINIC)
- service_address: "123 Main Street, Delhi"
- service_latitude, service_longitude: GPS location
- service_zone_id: FK to doctor_service_zones
- doctor_home_visit_schedule_id: FK to doctor_home_visit_schedules
- estimated_doctor_arrival: TIMESTAMP
- actual_doctor_arrival: TIMESTAMP
- actual_doctor_departure: TIMESTAMP
- doctor_arrived_notification_sent: boolean
```

---

## 🔄 Booking Flow for Home Visit

### **Step 1: Patient Initiates**
```
Patient: "I want home vaccination"
```

### **Step 2: System Validates Availability**
```
Checks:
✅ Is vaccination available for home? (doctor_services.can_do_home_visit)
✅ Is patient location in doctor's service zones? (doctor_service_zones)
✅ Is doctor available today? (doctor_home_visit_hours)
✅ How many home visits does doctor have today? (doctor_home_visit_schedules)
✅ Can fit in schedule with travel time? (min_travel_time_minutes)
```

### **Step 3: Show Available Doctors**
```
"Available doctors for home vaccination today:

Dr. Smith
  - Time: 15:00 (3rd visit of the day)
  - Price: ₹450 (home visit)
  - Estimated arrival: 14:50
  - Zone: North Delhi ✅

Dr. Jones
  - Time: 16:00 (2nd visit of the day)
  - Price: ₹450 (home visit)
  - Estimated arrival: 15:55
  - Zone: South Delhi ✅"
```

### **Step 4: Patient Books**
```
Appointment created:
  - location_type: HOME
  - doctor_id: Dr. Smith
  - appointment_time: 15:00
  - service_address: Patient's home address
  - service_latitude, service_longitude: GPS coords
```

### **Step 5: System Creates Route Entry**
```
doctor_home_visit_schedules:
  - scheduled_visit_order: 3 (3rd visit today)
  - estimated_arrival_time: 14:50 (calculated from previous visit + travel + buffer)
  - estimated_departure_time: 15:00 (visit duration 10 min)
```

### **Step 6: Real-time Execution**
```
14:45 - System notifies patient:
  "Dr. Smith arriving in 15 minutes!"
  
14:50 - Doctor confirms arrival via mobile app/WhatsApp:
  - actual_arrival_time: 14:50
  - doctor_arrived_notification_sent: true
  - Patient gets: "Dr. Smith has arrived"
  
15:00 - Doctor completes visit:
  - actual_departure_time: 15:00
  - visit_notes: "Vaccine administered, no adverse reactions"
  - appointment status: COMPLETED
  - payment: Mark as COMPLETED (if prepaid)
```

### **Step 7: Analytics & Optimization**
```
After all visits:
  - Actual travel time: 12 min (estimated 15 min) ✅
  - Distance: 2.5 km
  - Patient feedback: 5 stars
  
Next week:
  - Reorder visits based on geography
  - Schedule Patient C earlier in route (next door to Patient A)
```

---

## 📊 Example: Dr. Smith's Home Visit Schedule (Today)

```
Schedule:
═════════════════════════════════════════════════════════════

10:00-11:00  → Clinic (Doctor consultations)
11:00-12:00  → Clinic (Doctor consultations)
12:00-13:00  → Lunch break (clinic)

13:00 → HOME VISIT PHASE STARTS

13:00-13:30  Visit 1: Patient A (South Delhi)
             Vaccine + consultation
             
13:30-13:45  Travel + buffer (15km to next patient)

14:00-14:30  Visit 2: Patient B (South Delhi, nearby Patient A)
             Blood test
             
14:30-14:45  Travel + buffer (8km to next patient)

15:00-15:30  Visit 3: Patient C (North Delhi)
             Vaccine + consultation

15:30-16:00  Travel back + buffer

16:00        Back to clinic for evening consultations
             
═════════════════════════════════════════════════════════════

Route optimization:
  - Visits 1-2 grouped in South Delhi (minimize travel)
  - Visit 3 in North Delhi (on way back to clinic)
  - Total travel time: ~45 minutes for 3 visits
```

---

## 💰 Pricing Strategy

### **Home Visit Premium**
```
Clinic Price    →    Home Visit Price
─────────────────────────────────────
₹500 (consult)  →    ₹750 (+ convenience)
₹300 (vaccine)  →    ₹450 (+ convenience)
₹200 (blood)    →    ₹300 (+ technician travel)
```

**Why higher?**
- Doctor travel time (may not be packed schedule)
- Patient convenience (home visit vs. clinic travel)
- Reduced no-show rate (patient already at home)

---

## 🗺️ Geographic Zone Patterns

### **Pattern 1: Radius-Based (Most Common)**
```
Dr. Smith serves North Delhi:
  - Center: Clinic GPS (28.6129°N, 77.2295°E)
  - Radius: 5km
  - Auto-match patient home to radius
```

### **Pattern 2: Postal Code-Based**
```
Dr. Jones serves:
  - Postal codes: 110001, 110002, 110003, 110004
  - Postal code lookup when patient enters address
```

### **Pattern 3: Hybrid**
```
Dr. Smith:
  - North Delhi by radius (5km)
  - South Delhi by postal code (110001-110010)
```

---

## ⚠️ Edge Cases Handled

### **1. Double-Booking Prevention**
```
Dr. Smith's schedule:
  14:00-14:30 Visit 1
  + 15 min travel + 10 min buffer = 14:55 free
  
Patient tries to book: 14:30
  ❌ REJECTED: Not enough buffer time
  
Patient tries to book: 15:00
  ✅ ACCEPTED: Slot is free
```

### **2. Max Visits Cap**
```
Dr. Smith max: 8 home visits/day
  - Currently has: 6 visits scheduled
  - Remaining slots: 2
  - New booking: ✅ ACCEPTED
  
Dr. Jones max: 10 visits/day
  - Currently has: 10 visits scheduled
  - Remaining slots: 0
  - New booking: ❌ REJECTED (fully booked)
```

### **3. Outside Service Zone**
```
Patient location: 28.6400°N, 77.2100°E (South Delhi)
Dr. Smith zone: 5km radius from clinic (North Delhi)
Distance: 12km
Status: ❌ OUT OF ZONE
  
Show: "Dr. Smith doesn't service your area. 
       Try Dr. Jones (South Delhi specialist)"
```

### **4. Doctor on Leave**
```
Dr. Smith's leave: Sep 15-20 (vacation)
Patient tries to book: Sep 18
Status: ❌ REJECTED (doctor on leave)
  
doctor_leaves table checked first
```

---

## 🔐 Data Isolation

All tables include `clinic_id` foreign key:
```
doctor_services.clinic_id
doctor_home_visit_hours.clinic_id
doctor_service_zones.clinic_id
doctor_home_visit_schedules.clinic_id
appointments.clinic_id
```

**RLS Policy:**
```
Only show/edit home visits for your own clinic
Multiple clinics can coexist with zero data leakage
```

---

## 📈 Performance Considerations

### **Indexes Needed**
```sql
doctor_home_visit_hours (clinic_id, doctor_id, day_of_week)
doctor_service_zones (clinic_id, doctor_id, zone_code)
doctor_home_visit_schedules (clinic_id, doctor_id, estimated_arrival_time)
doctor_services (clinic_id, doctor_id, service_type_id)
appointments (location_type, doctor_id, appointment_date, service_zone_id)
```

### **Query Performance**
```
Find available doctors for home visit:
  - Without indexes: ~2000ms (scanning all zones)
  - With indexes: ~50ms (indexed lookup)
```

---

## 🚀 Implementation Phases

### **Phase 1: MVP** (Same day)
- [x] Schema design
- [ ] Create 4 new tables in Supabase
- [ ] Update appointments table
- [ ] Implement home visit booking logic in handlers
- [ ] Real-time arrival/departure tracking

### **Phase 2: Optimization** (Next week)
- [ ] Route optimization algorithm (TSP - minimize travel)
- [ ] Geofencing (accurate GPS-based zone validation)
- [ ] Doctor app for real-time location tracking
- [ ] Analytics dashboard (visit times, zone coverage)

### **Phase 3: Advanced** (Future)
- [ ] Automated scheduling (system assigns optimal doctor)
- [ ] Traffic-aware ETAs (integrate Google Maps API)
- [ ] Dynamic pricing (surge pricing during peak hours)
- [ ] Multi-clinic doctor routing (doctor serves 2+ clinics)

---

## 📋 SQL Queries You'll Need

### **1. Find Available Doctors for Home Visit**
```sql
-- Given: service_type, appointment_date, patient_location, clinic_id
SELECT d.id, d.name, ds.home_visit_price,
       COUNT(hv.id) as existing_visits_today,
       dz.zone_name
FROM doctors d
  JOIN doctor_services ds ON d.id = ds.doctor_id 
    AND ds.service_type_id = $1 AND ds.can_do_home_visit = true
  JOIN doctor_home_visit_hours dhh ON d.id = dhh.doctor_id
    AND dhh.day_of_week = EXTRACT(DOW FROM $2) AND dhh.is_active = true
  LEFT JOIN doctor_service_zones dz ON d.id = dz.doctor_id
    AND ST_DWithin(ST_Point(dz.center_longitude, dz.center_latitude), 
                    ST_Point($4, $3), dz.service_radius_km * 1000)  -- GIS distance
  LEFT JOIN doctor_home_visit_schedules hv ON d.id = hv.doctor_id
    AND DATE(hv.estimated_arrival_time) = $2
WHERE d.clinic_id = $5
GROUP BY d.id, d.name, ds.home_visit_price, dz.zone_name
HAVING COUNT(hv.id) < dhh.max_home_visits_per_day
ORDER BY COUNT(hv.id) ASC;  -- Doctors with fewer visits first
```

### **2. Calculate Next Available Time Slot**
```sql
-- Given: doctor_id, appointment_date, appointment_duration, clinic_id
SELECT 
  dhh.opening_time as day_start,
  dhh.closing_time as day_end,
  (hv.estimated_departure_time + 
   (dhh.min_travel_time_minutes || ' minutes')::interval +
   (dhh.buffer_after_appointment_minutes || ' minutes')::interval) as next_free_slot
FROM doctor_home_visit_hours dhh
  LEFT JOIN doctor_home_visit_schedules hv ON dhh.doctor_id = hv.doctor_id
    AND DATE(hv.estimated_arrival_time) = $2
WHERE dhh.doctor_id = $1 AND dhh.day_of_week = EXTRACT(DOW FROM $2)
ORDER BY hv.estimated_departure_time DESC NULLS FIRST
LIMIT 1;
```

### **3. Get Doctor's Day Schedule**
```sql
SELECT 
  a.id, a.appointment_time, a.service_address,
  p.name as patient_name,
  st.name as service_name,
  hv.scheduled_visit_order,
  hv.estimated_arrival_time,
  hv.actual_arrival_time,
  hv.visit_notes
FROM appointments a
  JOIN doctor_home_visit_schedules hv ON a.id = hv.appointment_id
  JOIN patients p ON a.patient_phone = p.phone
  JOIN service_types st ON a.service_type_id = st.id
WHERE hv.doctor_id = $1 AND DATE(hv.estimated_arrival_time) = $2
  AND a.clinic_id = $3
ORDER BY hv.scheduled_visit_order;
```

---

## 🎯 Next Steps

1. ✅ Schema designed (15 tables total, including 4 new ones)
2. Create tables in Supabase
3. Update handlers to support home visit booking
4. Implement real-time tracking
5. Add route optimization (Phase 2)

**Ready to proceed with implementation?**
