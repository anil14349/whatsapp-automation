// ============================================================
// Util_AdminDashboard — Admin control panel for non-technical staff
// One function to rule them all: showAdminDashboard()
// ============================================================



// ========================================================
// MAIN ADMIN DASHBOARD
// ========================================================
// Call this once to see admin options menu
// Run from: Extensions → Apps Script → Select "showAdminDashboard" → Run

function showAdminDashboard() {

    const ui = SpreadsheetApp.getUi();

    const clinicName = getClinicName();

    const response = ui.alert(
        "🏥 " + clinicName + " WhatsApp Admin Dashboard\n\n" +
        "What would you like to do?\n",
        ui.ButtonSet.YES_NO_CANCEL
    );

    // First menu: User picks category
    if (response === ui.Button.YES) {
        showSetupMenu();
    } else if (response === ui.Button.NO) {
        showMaintenanceMenu();
    } else {
        showMonitoringMenu();
    }
}



// ========================================================
// SETUP MENU (One-time setup)
// ========================================================

function showSetupMenu() {

    const ui = SpreadsheetApp.getUi();

    const response = ui.alert(
        "⚙️ SETUP OPTIONS\n\n" +
        "YES  = Setup automatic cleanup (one-time)\n" +
        "NO   = Initialize all sheets\n" +
        "CANCEL = Back to main menu\n",
        ui.ButtonSet.YES_NO_CANCEL
    );

    if (response === ui.Button.YES) {
        runSetupCleanupTriggers();
    } else if (response === ui.Button.NO) {
        runSheetInitialization();
    } else {
        showAdminDashboard();
    }
}



// ========================================================
// MAINTENANCE MENU (Run cleanup now)
// ========================================================

function showMaintenanceMenu() {

    const ui = SpreadsheetApp.getUi();

    const response = ui.alert(
        "🧹 MAINTENANCE OPTIONS\n\n" +
        "YES  = Run all cleanup now\n" +
        "NO   = View cleanup status\n" +
        "CANCEL = Back to main menu\n",
        ui.ButtonSet.YES_NO_CANCEL
    );

    if (response === ui.Button.YES) {
        runAllCleanupNow();
    } else if (response === ui.Button.NO) {
        showCleanupStatus();
    } else {
        showAdminDashboard();
    }
}



// ========================================================
// MONITORING MENU (View reports)
// ========================================================

function showMonitoringMenu() {

    const ui = SpreadsheetApp.getUi();

    const response = ui.alert(
        "📊 MONITORING OPTIONS\n\n" +
        "YES  = View cost savings report\n" +
        "NO   = View performance metrics\n" +
        "CANCEL = Back to main menu\n",
        ui.ButtonSet.YES_NO_CANCEL
    );

    if (response === ui.Button.YES) {
        showCostReport();
    } else if (response === ui.Button.NO) {
        showPerformanceReport();
    } else {
        showAdminDashboard();
    }
}



// ========================================================
// SETUP: Create automatic cleanup triggers
// ========================================================

function runSetupCleanupTriggers() {

    const ui = SpreadsheetApp.getUi();

    try {

        const result = createAutoCleanupTriggers();

        ui.alert(
            "✅ SETUP COMPLETE!\n\n" +
            "Automatic cleanup enabled:\n\n" +
            "📅 Daily (2 AM UTC): Message deduplication\n" +
            "📅 Weekly (Sunday 3 AM): Waitlist cleanup\n" +
            "📅 Every 6 hours: Slot reservations\n\n" +
            "Your system is now on autopilot! 🚀"
        );

    } catch (error) {

        ui.alert(
            "❌ ERROR: " + error.message +
            "\n\nPlease contact your developer."
        );
    }

    showAdminDashboard();
}



// ========================================================
// SETUP: Initialize all sheets
// ========================================================

function runSheetInitialization() {

    const ui = SpreadsheetApp.getUi();

    try {

        const result = initializeWhatsAppBotSheets();

        let message = "✅ SHEETS INITIALIZED!\n\n";

        for (const sheet of result.sheets) {
            message +=
                (sheet.created ? "✨ CREATED: " : "✓ EXISTS: ") +
                sheet.sheet + "\n";
        }

        ui.alert(message);

    } catch (error) {

        ui.alert(
            "❌ ERROR: " + error.message
        );
    }

    showAdminDashboard();
}



// ========================================================
// MAINTENANCE: Run all cleanup immediately
// ========================================================

function runAllCleanupNow() {

    const ui = SpreadsheetApp.getUi();

    try {

        // Run all cleanup operations
        const dedupCount =
            cleanupExpiredDeduplicationRecords();

        const waitlistCount =
            cleanupExpiredWaitlistEntries();

        const reservationCount =
            cleanupExpiredSlotReservations();

        const message =
            "✅ CLEANUP COMPLETE!\n\n" +
            "Deduplication records removed: " + dedupCount + "\n" +
            "Waitlist entries removed: " + waitlistCount + "\n" +
            "Slot reservations removed: " + reservationCount + "\n\n" +
            "Total cleaned: " + (dedupCount + waitlistCount + reservationCount) + " rows";

        ui.alert(message);

    } catch (error) {

        ui.alert(
            "❌ ERROR: " + error.message
        );
    }

    showAdminDashboard();
}



// ========================================================
// MAINTENANCE: Show cleanup status
// ========================================================

function showCleanupStatus() {

    const ui = SpreadsheetApp.getUi();

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let status = "📋 CLEANUP STATUS\n\n";

    // Check Message_Deduplication sheet
    const dedupSheet =
        ss.getSheetByName("Message_Deduplication");

    if (dedupSheet) {
        const dedupRows = dedupSheet.getLastRow() - 1;
        status += "Message Dedup: " + dedupRows + " records\n";
    }

    // Check Waitlist sheet
    const waitlistSheet =
        ss.getSheetByName("Waitlist");

    if (waitlistSheet) {
        const waitlistRows = waitlistSheet.getLastRow() - 1;
        status += "Waitlist: " + waitlistRows + " entries\n";
    }

    // Check Slot_Reservations sheet
    const reservationSheet =
        ss.getSheetByName("Slot_Reservations");

    if (reservationSheet) {
        const reservationRows = reservationSheet.getLastRow() - 1;
        status += "Slot Reservations: " + reservationRows + " rows\n";
    }

    // Check if triggers are active
    const triggers = ScriptApp.getProjectTriggers();
    const activeCleanupTriggers = triggers.filter(function (t) {
        const handler = t.getHandlerFunction();
        return (
            handler === "cleanupExpiredDeduplicationRecordsAuto" ||
            handler === "cleanupExpiredWaitlistEntries" ||
            handler === "cleanupExpiredSlotReservationsAuto"
        );
    });

    status += "\n⏰ Active Triggers: " + activeCleanupTriggers.length;

    ui.alert(status);

    showAdminDashboard();
}



// ========================================================
// MONITORING: Show cost savings report
// ========================================================

function showCostReport() {

    const ui = SpreadsheetApp.getUi();

    try {

        const report = logCostOptimizations();

        let message = "💰 COST SAVINGS REPORT\n\n";
        message += "Last 30 days:\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━\n\n";
        message += "Appointments: " + report.appointmentsLastMonth + "\n";
        message += "Baseline cost: $" + report.baselineCostPerMonth + "\n";
        message += "Optimized cost: $" + report.optimizedCostPerMonth + "\n\n";

        message += "💵 SAVINGS\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━\n";
        message += "Monthly: $" + report.monthlySavings + "\n";
        message += "Percentage: " + report.savingsPercentage + "%\n\n";

        message += "📊 ACTIVE OPTIMIZATIONS\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━\n";

        // Safe access to optimizationsActive (handle missing array)
        if (
            report.optimizationsActive &&
            Array.isArray(report.optimizationsActive)
        ) {
            message += report.optimizationsActive.join("\n");
        } else {
            message += "(Unable to retrieve optimizations)";
        }

        ui.alert(message);

    } catch (error) {

        ui.alert(
            "❌ ERROR: " + error.message
        );
    }

    showAdminDashboard();
}



// ========================================================
// MONITORING: Show performance metrics
// ========================================================

function showPerformanceReport() {

    const ui = SpreadsheetApp.getUi();

    try {

        const metrics = logPerformanceMetrics();

        let message = "⚡ PERFORMANCE REPORT\n\n";

        message += "Cache Performance\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━\n";
        message += "Patient lookups: " + (metrics.patientCacheHitRate * 100).toFixed(1) + "% hit rate\n";
        message += "Session lookups: " + (metrics.sessionCacheHitRate * 100).toFixed(1) + "% hit rate\n";
        message += "Appointment lookups: " + (metrics.appointmentCacheHitRate * 100).toFixed(1) + "% hit rate\n\n";

        message += "Sheet Size\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━\n";
        message += "Patients: " + metrics.patientRowCount + " rows\n";
        message += "Appointments: " + metrics.appointmentRowCount + " rows\n";
        message += "Sessions: " + metrics.sessionRowCount + " rows\n\n";

        message += "Scalability Status: " + metrics.scalabilityStatus;

        ui.alert(message);

    } catch (error) {

        ui.alert(
            "❌ ERROR: " + error.message
        );
    }

    showAdminDashboard();
}



// ========================================================
// QUICK ACTION BUTTONS (Optional - add to View_Menus.gs)
// ========================================================
// These are helper functions to add menu items quickly

function addAdminMenuItems() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    ui.createMenu("🏥 Admin Dashboard")
        .addItem("Open Admin Panel", "showAdminDashboard")
        .addSeparator()
        .addItem("Setup Cleanup Triggers", "runSetupCleanupTriggers")
        .addItem("Run Cleanup Now", "runAllCleanupNow")
        .addSeparator()
        .addItem("View Cost Report", "showCostReport")
        .addItem("View Performance Report", "showPerformanceReport")
        .addToUi();
}



// ========================================================
// INITIALIZATION: Call this once from onOpen
// ========================================================

function initializeAdminDashboard() {

    // Run this in onOpen() to add menu items automatically
    addAdminMenuItems();
}
