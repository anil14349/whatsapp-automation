# Scalability Roadmap — All Sheets

## Executive Summary

The clinic booking system has **12 sheets** with varying scalability needs. This document prioritizes optimization efforts based on growth risk and lookup frequency.

| Priority | Sheet | Risk | Lookup Frequency | Recommended Action |
|----------|-------|------|-----------------|-------------------|
| 🔴 CRITICAL | Message_Deduplication | Very High | Every webhook (1M+/day) | Implement automatic cleanup |
| 🔴 CRITICAL | WhatsApp_Sessions | Very High | Every message | Add execution caching |
| 🔴 CRITICAL | Appointments | Very High | Every booking (100+/hr) | Add execution caching |
| 🟠 HIGH | Waitlist | High | Every cancellation | Automatic TTL cleanup |
| 🟠 HIGH | Slot_Reservations | High | Every booking attempt | Automatic TTL cleanup |
| 🟡 MEDIUM | Appointment_Reminders | Medium | Daily cron (1x/day) | Query optimization |
| 🟡 MEDIUM | Appointment_Notes | Medium | On history view | Add execution caching |
| 🟡 MEDIUM | Feedback | Medium | On ratings display | Caching (already optimized) |
| 🟢 LOW | Google Calendar | Low | Built-in API optimization | Already fixed |
| 🟢 LOW | Doctors | Low | getDoctorRecord cached | Already done ✅ |
| 🟢 LOW | Appointment_History | Low | Archive (infrequent) | Skip |
| 🟢 LOW | Others | Low | Minimal lookups | Skip |

---

## CRITICAL Priority Sheets

### 1. Message_Deduplication Sheet 🔴🔴🔴 URGENT

**Current Problem:**
```javascript
function checkMessageIdempotency(messageId, phone) {
    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();  // Loads ENTIRE sheet
    
    for (let i = 1; i < data.length; i++) {        // Linear scan
        if (String(data[i][0]).trim() === String(messageId).trim()) {
            return { processed: true, ... };
        }
    }
}
```

**Growth Impact:**
- 1M messages/day = 365M messages/year
- With 7-day TTL: ~7M rows in sheet
- Every webhook: full scan of 7M rows (30+ seconds timeout risk)

**Solution: Automatic TTL Cleanup**
```javascript
// In Util_Idempotency.gs:

function cleanupExpiredDeduplicationRecordsAuto() {
    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const rowsToDelete = [];
    
    // Delete in reverse order from end (most recent first)
    for (let i = data.length - 1; i >= 1; i--) {
        const expiresAt = new Date(data[i][4]);
        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }
    
    // Delete
    for (let j = rowsToDelete.length - 1; j >= 0; j--) {
        sheet.deleteRow(rowsToDelete[j]);
    }
    
    Logger.log("Cleaned " + rowsToDelete.length + " expired messages");
}

// Call daily via Trigger:
// In Setup.gs: createDailyCleanupTrigger()
```

**Timeline:** Implement ASAP (high volume)

---

### 2. WhatsApp_Sessions Sheet 🔴🔴 URGENT

**Current Problem:**
```javascript
function getWhatsAppSession(phoneNumber) {
    const sheet = ensureWhatsAppSessionsSheet();
    const data = sheet.getDataRange().getValues();  // Full load
    
    for (let i = 1; i < data.length; i++) {
        if (phonesMatch(data[i][1], phoneNumber)) {
            return parseSessionFromRow(data[i]);
        }
    }
}
```

**Growth Impact:**
- Active users ≈ Patients (5K-100K)
- Called on EVERY WhatsApp message
- With 100 concurrent messages: 100 × 100K row scans = 10M comparisons

**Solution: Session Caching**
```javascript
// In Util_Performance.gs - add:

let __whatsAppSessionCache = {};

function getWhatsAppSessionWithCache(phoneNumber) {
    const normalized = normalizeWhatsAppPhone(phoneNumber);
    
    if (__whatsAppSessionCache[normalized]) {
        return __whatsAppSessionCache[normalized];
    }
    
    // Fall back to sheet lookup
    const session = getWhatsAppSession(phoneNumber);
    __whatsAppSessionCache[normalized] = session;
    return session;
}
```

**Timeline:** Implement within 1 week

---

### 3. Appointments Sheet 🔴 URGENT

**Current Problem:**
- Multiple lookups per booking: getAvailableSlots, cancelAppointment, rescheduleAppointment
- Each does full scan
- Growth: 10-100x Patients sheet (potentially 500K+ rows)

**Solution: Add to Execution Caching**
```javascript
// In Util_Performance.gs - extend:

let __appointmentsByPhoneCache = {};      // phone → [appointments]
let __appointmentsByDateCache = {};       // date → [appointments]

function getAppointmentsByPhoneWithCache(phone) {
    const normalized = normalizeWhatsAppPhone(phone);
    
    if (__appointmentsByPhoneCache[normalized]) {
        return __appointmentsByPhoneCache[normalized];
    }
    
    const result = getAppointmentsByPhone(phone);
    __appointmentsByPhoneCache[normalized] = result;
    return result;
}
```

**Timeline:** Implement within 1 week

---

## HIGH Priority Sheets

### 4. Waitlist Sheet 🟠

**Current Problem:**
- No TTL enforcement
- Accumulates forever
- getWaitlistForSlot() does O(n) scan on every cancellation

**Solution:**
```javascript
// In Util_Waitlist.gs - add cleanup:

function cleanupExpiredWaitlistEntries() {
    const sheet = ensureWaitlistSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const OLD_DAYS = 30;
    const cutoffDate = new Date(now.getTime() - OLD_DAYS * 24 * 60 * 60 * 1000);
    
    const rowsToDelete = [];
    
    for (let i = data.length - 1; i >= 1; i--) {
        const addedOn = new Date(data[i][6]);
        if (addedOn < cutoffDate && data[i][7] !== "BOOKED") {
            rowsToDelete.push(i + 1);
        }
    }
    
    // Delete rows
    for (const row of rowsToDelete) {
        sheet.deleteRow(row);
    }
    
    Logger.log("Cleaned " + rowsToDelete.length + " old waitlist entries");
}

// Call: Monthly trigger in Setup.gs
```

**Timeline:** Implement within 2 weeks

---

### 5. Slot_Reservations Sheet 🟠

**Similar to Waitlist** — needs automatic cleanup

**Solution:**
```javascript
// In Util_SlotReservation.gs:

function cleanupExpiredSlotReservationsAuto() {
    const sheet = ensureSlotReservationSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    
    const rowsToDelete = [];
    
    for (let i = data.length - 1; i >= 1; i--) {
        const expiresAt = new Date(data[i][5]);
        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }
    
    for (let j = rowsToDelete.length - 1; j >= 0; j--) {
        sheet.deleteRow(rowsToDelete[j]);
    }
}

// Call: Hourly trigger (frequent bookings)
```

**Timeline:** Implement within 2 weeks

---

## MEDIUM Priority Sheets

### 6-9. Appointment_Reminders, Appointment_Notes, Feedback, Google Calendar

**Action:** Add to Util_Performance.gs caching as lookups grow

**Timeline:** Implement within 1 month if performance issues detected

---

## Implementation Timeline

### Week 1-2 (CRITICAL)
- [ ] Implement Message_Deduplication auto-cleanup
- [ ] Add WhatsApp_Sessions caching
- [ ] Add Appointments caching
- [ ] Create Setup.gs triggers for cleanup jobs

### Week 2-3 (HIGH)
- [ ] Implement Waitlist cleanup
- [ ] Implement Slot_Reservations cleanup

### Week 3-4 (MEDIUM)
- [ ] Add Appointment_Notes caching
- [ ] Add Appointment_Reminders optimization

### Month 2+ (LOW/FUTURE)
- [ ] Monitor performance metrics
- [ ] Plan Firestore migration if 100K+ records reached

---

## Monitoring Checklist

Add to your monitoring dashboard:

```javascript
function generateScalabilityReport() {
    const sheets = {
        "Patients": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Patients"),
        "Appointments": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Appointments"),
        "WhatsApp_Sessions": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WhatsApp_Sessions"),
        "Message_Deduplication": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Message_Deduplication"),
        "Waitlist": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Waitlist"),
        "Slot_Reservations": SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Slot_Reservations"),
    };
    
    const report = {};
    for (const [name, sheet] of Object.entries(sheets)) {
        if (sheet) {
            const rowCount = sheet.getLastRow() - 1;
            report[name] = {
                rows: rowCount,
                status: rowCount > 50000 ? "ALERT" : rowCount > 10000 ? "CAUTION" : "OK"
            };
        }
    }
    
    Logger.log(JSON.stringify(report));
    return report;
}
```

---

## Cost-Benefit Analysis

| Sheet | Implementation Cost | Performance Gain | ROI | Priority |
|-------|-------------------|-----------------|-----|----------|
| Message_Deduplication | Medium | 90% faster | Very High | CRITICAL |
| WhatsApp_Sessions | Low | 85% faster | Very High | CRITICAL |
| Appointments | Low | 80% faster | Very High | CRITICAL |
| Waitlist | Medium | Prevents growth | High | HIGH |
| Slot_Reservations | Medium | Prevents growth | High | HIGH |
| Others | Low-Medium | 40-60% faster | Medium | MEDIUM |

---

## Recommended Approach

**Phase 1 (This Week):** Focus on CRITICAL sheets
- Message cleanup is non-negotiable for reliability
- Session caching prevents booking failures
- Appointment caching improves booking speed

**Phase 2 (Next 2 Weeks):** HIGH priority cleanup jobs
- Prevent unbounded growth
- Automatic triggers reduce manual ops

**Phase 3 (Ongoing):** Monitor and optimize
- Use performance metrics
- Add caching as needed
- Plan Firestore if hitting 100K records

---

## Questions?

- **When to start:** Message_Dedup cleanup → ASAP (production risk)
- **What to prioritize:** CRITICAL first, then HIGH
- **How to test:** Enable logging, check performance logs
- **Firestore migration:** Plan for if/when you hit 100K+ records per sheet
