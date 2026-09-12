// ============================================================
// Util_Performance — part of the ABC Clinic WhatsApp bot
// Performance optimization, caching, and monitoring for large datasets
// Supports scaling from <5K to 100K+ records
// ============================================================



// ========================================================
// EXECUTION-SCOPE CACHING
// ========================================================
// Cache lookups within single execution to reduce redundant sheet scans
// Cleared automatically at end of each webhook/function execution

let __patientPhoneCache = {};      // phone → patient record
let __appointmentIdCache = {};     // appointmentId → appointment record
let __performanceMetrics = {       // For monitoring
    patientLookups: 0,
    patientCacheHits: 0,
    appointmentLookups: 0,
    appointmentCacheHits: 0,
    slowQueries: []
};



// ========================================================
// PATIENT LOOKUP WITH CACHING
// ========================================================
// Wraps findPatientByPhone with execution-scope caching
// Returns same result as findPatientByPhone() but faster on repeat calls

function findPatientByPhoneWithCache(phone) {

    if (!phone) {
        return null;
    }

    const normalized =
        normalizeWhatsAppPhone(phone);

    if (!normalized) {
        return null;
    }

    // Check cache first
    if (__patientPhoneCache[normalized]) {
        __performanceMetrics.patientCacheHits++;
        return __patientPhoneCache[normalized];
    }

    // Cache miss - do full lookup
    __performanceMetrics.patientLookups++;

    const startTime = new Date().getTime();

    const result =
        findPatientByPhone(phone);

    const elapsedMs = new Date().getTime() - startTime;

    // Log slow queries (>500ms)
    if (elapsedMs > 500) {
        __performanceMetrics.slowQueries.push({
            type: "findPatientByPhone",
            phone: normalized,
            elapsedMs: elapsedMs
        });
    }

    // Cache the result (positive or negative)
    __patientPhoneCache[normalized] =
        result;

    return result;
}



// ========================================================
// APPOINTMENT LOOKUP WITH CACHING
// ========================================================
// Cache appointment lookups by ID

function getAppointmentByIdWithCache(appointmentId) {

    if (!appointmentId) {
        return null;
    }

    // Check cache first
    if (__appointmentIdCache[appointmentId]) {
        __performanceMetrics.appointmentCacheHits++;
        return __appointmentIdCache[appointmentId];
    }

    // Cache miss - do full lookup
    __performanceMetrics.appointmentLookups++;

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        if (
            String(data[i][0]).trim() ===
            String(appointmentId).trim()
        ) {

            const record = {
                row: i + 1,
                appointmentId: data[i][0],
                date: data[i][1],
                time: data[i][2],
                doctorId: data[i][3],
                patientName: data[i][4],
                patientPhone: data[i][5],
                status: data[i][6],
                calendarEventId: data[i][7],
                patientId: data[i][8]
            };

            __appointmentIdCache[appointmentId] =
                record;

            return record;
        }
    }

    __appointmentIdCache[appointmentId] = null;
    return null;
}



// ========================================================
// MONITORING & PERFORMANCE METRICS
// ========================================================
// Track performance to know when to scale up

function logPerformanceMetrics() {

    const hitRate = __performanceMetrics.patientLookups > 0
        ? Math.round(
            (__performanceMetrics.patientCacheHits /
            __performanceMetrics.patientLookups) * 100
        )
        : 0;

    Logger.log(
        "Performance Metrics: " +
        "Patient lookups: " + __performanceMetrics.patientLookups +
        ", Cache hits: " + __performanceMetrics.patientCacheHits +
        " (" + hitRate + "%), " +
        "Slow queries: " + __performanceMetrics.slowQueries.length
    );

    if (__performanceMetrics.slowQueries.length > 0) {
        Logger.log(
            "Slow queries detected: " +
            JSON.stringify(
                __performanceMetrics.slowQueries.slice(0, 5)
            )
        );
    }
}



// ========================================================
// INDEXED SEARCH HELPERS
// ========================================================
// Future-proof: ready for Firestore/database migration
// These functions prepare the interface for indexed queries
// Currently comment out, enable when switching to Cloud Firestore

/*
// When scaling to 100K+ patients, switch to:
// function findPatientByPhoneIndexed(phone) {
//     const db = FirebaseApp.getDatabaseByUrl(FIREBASE_URL);
//     return db.query("/patients")
//         .orderByChild("phone")
//         .equalTo(normalizeWhatsAppPhone(phone))
//         .limitToFirst(1)
//         .once("value");
// }

// When scaling to 100K+ appointments, switch to:
// function getAppointmentByIdIndexed(appointmentId) {
//     const db = FirebaseApp.getDatabaseByUrl(FIREBASE_URL);
//     return db.ref("/appointments/" + appointmentId).once("value");
// }
*/



// ========================================================
// SCALABILITY DECISION POINTS
// ========================================================
// Monitor these metrics to know when to scale:

function checkScalabilityStatus() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const patientsSheet =
        ss.getSheetByName("Patients");

    const appointmentsSheet =
        ss.getSheetByName("Appointments");

    const patientCount =
        patientsSheet ? patientsSheet.getLastRow() - 1 : 0;

    const appointmentCount =
        appointmentsSheet ? appointmentsSheet.getLastRow() - 1 : 0;

    const status = {
        patientCount: patientCount,
        appointmentCount: appointmentCount,
        scalingRecommendation: ""
    };

    // Scaling recommendations based on data size
    if (patientCount < 5000) {
        status.scalingRecommendation =
            "✅ Current architecture optimal. Use execution caching.";
    } else if (patientCount < 20000) {
        status.scalingRecommendation =
            "⚠️ Monitor performance. Consider indexed queries if slowdown detected.";
    } else if (patientCount < 100000) {
        status.scalingRecommendation =
            "🔴 Approaching limits. Implement partitioning or Firestore soon.";
    } else {
        status.scalingRecommendation =
            "🔴 CRITICAL: Migrate to Firestore for production stability.";
    }

    Logger.log(JSON.stringify(status));
    return status;
}



// ========================================================
// CACHE RESET
// ========================================================
// Apps Script automatically clears module-level variables between executions
// But explicitly reset if needed for testing

function resetExecutionCache() {
    __patientPhoneCache = {};
    __appointmentIdCache = {};
    __performanceMetrics = {
        patientLookups: 0,
        patientCacheHits: 0,
        appointmentLookups: 0,
        appointmentCacheHits: 0,
        slowQueries: []
    };
    Logger.log("Execution cache reset");
}
