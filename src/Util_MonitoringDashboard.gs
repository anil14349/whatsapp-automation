// ============================================================
// Util_MonitoringDashboard — Track costs and metrics in Google Sheets
// Automatically logs cost data to a dashboard sheet
// Call initializeMonitoringDashboard() once to set up
// ============================================================



// ========================================================
// INITIALIZE MONITORING DASHBOARD SHEET
// ========================================================

function initializeMonitoringDashboard() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Cost_Dashboard");

    // Create sheet if doesn't exist
    if (!sheet) {

        sheet = ss.insertSheet("Cost_Dashboard");

        // Header row
        sheet.appendRow([
            "Date",
            "Month",
            "Appointments",
            "Baseline Cost",
            "Optimized Cost",
            "Monthly Savings",
            "Savings %",
            "Skip 24hr",
            "Session Window",
            "Feedback Sampling",
            "Patient Cache Hit %",
            "Session Cache Hit %",
            "Total Patients",
            "Total Appointments",
            "Notes"
        ]);

        // Format header
        const headerRange = sheet.getRange(1, 1, 1, 15);
        headerRange.setBackground("#4285f4");
        headerRange.setFontColor("white");
        headerRange.setFontWeight("bold");

        // Auto-resize columns
        sheet.setColumnWidth(1, 100);   // Date
        sheet.setColumnWidth(2, 80);    // Month
        sheet.setColumnWidth(3, 80);    // Appointments
        sheet.setColumnWidth(4, 110);   // Baseline Cost
        sheet.setColumnWidth(5, 110);   // Optimized Cost
        sheet.setColumnWidth(6, 120);   // Monthly Savings
        sheet.setColumnWidth(7, 80);    // Savings %
        sheet.setColumnWidth(8, 80);    // Skip 24hr
        sheet.setColumnWidth(9, 110);   // Session Window
        sheet.setColumnWidth(10, 120);  // Feedback Sampling
        sheet.setColumnWidth(11, 120);  // Patient Cache
        sheet.setColumnWidth(12, 120);  // Session Cache
        sheet.setColumnWidth(13, 100);  // Total Patients
        sheet.setColumnWidth(14, 120);  // Total Appointments
        sheet.setColumnWidth(15, 150);  // Notes

        Logger.log("Cost_Dashboard sheet created");
    }

    return sheet;
}



// ========================================================
// LOG TODAY'S METRICS
// ========================================================

function logDailyMetrics() {

    const sheet = initializeMonitoringDashboard();

    const today = new Date();
    const month = today.toLocaleString("en-US", { month: "short", year: "numeric" });

    // Get cost report
    let costReport = {};
    try {
        costReport = generateCostSavingsReport();
    } catch (e) {
        Logger.log("Cost report error: " + e.message);
    }

    // Get performance metrics
    let perfMetrics = {};
    try {
        perfMetrics = logPerformanceMetrics();
    } catch (e) {
        Logger.log("Performance metrics error: " + e.message);
    }

    // Determine active optimizations
    const skip24hr =
        COST_OPTIMIZATION.SEND_24HR_REMINDER ?
        "No" : "Yes";

    const sessionWindow =
        COST_OPTIMIZATION.USE_SESSION_WINDOW ?
        "Yes" : "No";

    const feedbackSampling =
        (COST_OPTIMIZATION.FEEDBACK_SAMPLING_RATE * 100).toFixed(0) + "%";

    // Add row
    sheet.appendRow([
        today.toLocaleDateString(),
        month,
        costReport.appointmentsLastMonth || 0,
        "$" + (costReport.baselineCostPerMonth || 0),
        "$" + (costReport.optimizedCostPerMonth || 0),
        "$" + (costReport.monthlySavings || 0),
        (costReport.savingsPercentage || 0) + "%",
        skip24hr,
        sessionWindow,
        feedbackSampling,
        (perfMetrics.patientCacheHitRate * 100 || 0).toFixed(1) + "%",
        (perfMetrics.sessionCacheHitRate * 100 || 0).toFixed(1) + "%",
        perfMetrics.patientRowCount || 0,
        perfMetrics.appointmentRowCount || 0,
        "Auto-logged"
    ]);

    Logger.log("Daily metrics logged successfully");
}



// ========================================================
// CREATE SCHEDULED TRIGGER FOR DAILY LOGGING
// ========================================================

function setupDailyMetricsLogging() {

    // Delete existing daily metrics trigger
    const triggers = ScriptApp.getProjectTriggers();

    for (const trigger of triggers) {

        if (
            trigger.getHandlerFunction() ===
            "logDailyMetricsAuto"
        ) {
            ScriptApp.deleteTrigger(trigger);
        }
    }

    // Create new daily trigger at 11 PM UTC
    ScriptApp.newTrigger("logDailyMetricsAuto")
        .timeBased()
        .atHour(23)
        .everyDays(1)
        .create();

    Logger.log("Daily metrics logging trigger created (11 PM UTC)");

    return {
        success: true,
        message: "Daily metrics logging enabled"
    };
}



// ========================================================
// WRAPPER FOR TRIGGER EXECUTION
// ========================================================

function logDailyMetricsAuto() {

    try {
        logDailyMetrics();
    } catch (error) {
        Logger.log("Error in daily metrics: " + error.message);
    }
}



// ========================================================
// GENERATE MONTHLY SUMMARY REPORT
// ========================================================

function generateMonthlySummaryReport() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Cost_Dashboard");

    if (!sheet) {
        return { error: "Cost_Dashboard not found" };
    }

    const data = sheet.getDataRange().getValues();

    if (data.length < 2) {
        return { error: "No data to summarize" };
    }

    // Get current month
    const today = new Date();
    const currentMonth =
        today.toLocaleString("en-US", { month: "short", year: "numeric" });

    // Filter rows for current month
    let monthlyData = [];

    for (let i = 1; i < data.length; i++) {

        const month = String(data[i][1]);

        if (month.includes(currentMonth)) {
            monthlyData.push(data[i]);
        }
    }

    if (monthlyData.length === 0) {
        return {
            month: currentMonth,
            message: "No data for this month yet"
        };
    }

    // Calculate averages and totals
    let totalAppts = 0;
    let totalBaseline = 0;
    let totalOptimized = 0;
    let totalSavings = 0;
    let avgCacheHit = 0;

    for (const row of monthlyData) {

        // Parse values carefully
        const appts = parseInt(row[2]) || 0;
        const baseline = parseFloat(
            String(row[3]).replace("$", "")
        ) || 0;
        const optimized = parseFloat(
            String(row[4]).replace("$", "")
        ) || 0;
        const savings = parseFloat(
            String(row[5]).replace("$", "")
        ) || 0;
        const cacheHit = parseFloat(
            String(row[10]).replace("%", "")
        ) || 0;

        totalAppts += appts;
        totalBaseline += baseline;
        totalOptimized += optimized;
        totalSavings += savings;
        avgCacheHit += cacheHit;
    }

    avgCacheHit = avgCacheHit / monthlyData.length;

    const savingsPercent =
        totalBaseline > 0 ?
        ((totalSavings / totalBaseline) * 100).toFixed(1) :
        0;

    return {
        month: currentMonth,
        daysTracked: monthlyData.length,
        totalAppointments: totalAppts,
        totalBaselineCost: totalBaseline.toFixed(2),
        totalOptimizedCost: totalOptimized.toFixed(2),
        totalSavings: totalSavings.toFixed(2),
        savingsPercentage: savingsPercent,
        avgCacheHitRate: avgCacheHit.toFixed(1)
    };
}



// ========================================================
// DISPLAY MONTHLY SUMMARY
// ========================================================

function showMonthlySummary() {

    const ui = SpreadsheetApp.getUi();

    const summary = generateMonthlySummaryReport();

    if (summary.error) {
        ui.alert("❌ " + summary.error);
        return;
    }

    if (summary.message) {
        ui.alert("📊 " + summary.message);
        return;
    }

    let message =
        "📊 MONTHLY SUMMARY — " + summary.month + "\n\n";

    message += "━━━━━━━━━━━━━━━━━━━━━━\n";
    message += "Days Tracked: " + summary.daysTracked + "\n";
    message += "Total Appointments: " + summary.totalAppointments + "\n\n";

    message += "💰 COSTS\n";
    message += "━━━━━━━━━━━━━━━━━━━━━━\n";
    message += "Baseline: $" + summary.totalBaselineCost + "\n";
    message += "Optimized: $" + summary.totalOptimizedCost + "\n";
    message += "Saved: $" + summary.totalSavings + "\n";
    message += "Savings: " + summary.savingsPercentage + "%\n\n";

    message += "⚡ PERFORMANCE\n";
    message += "━━━━━━━━━━━━━━━━━━━━━━\n";
    message += "Avg Cache Hit: " + summary.avgCacheHitRate + "%";

    ui.alert(message);
}



// ========================================================
// CREATE COMPREHENSIVE DASHBOARD IN NEW SHEET
// ========================================================

function createVisualDashboard() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    // Find or create Dashboard sheet
    let dashSheet =
        ss.getSheetByName("Dashboard");

    if (!dashSheet) {
        dashSheet = ss.insertSheet("Dashboard");
    } else {
        dashSheet.clear();
    }

    const summary =
        generateMonthlySummaryReport();

    // Title
    dashSheet.getRange(1, 1, 1, 3).mergeAcrossCells();
    dashSheet.getRange(1, 1).setValue("📊 WhatsApp Clinic Dashboard");
    dashSheet.getRange(1, 1).setFontSize(18).setFontWeight("bold");

    // Current month indicator
    dashSheet.getRange(3, 1).setValue("Current Month:");
    dashSheet.getRange(3, 2).setValue(summary.month).setFontWeight("bold");

    // Cost section
    dashSheet.getRange(5, 1).setValue("💰 Cost Analysis");
    dashSheet.getRange(5, 1).setFontWeight("bold").setBackground("#fff3cd");

    dashSheet.getRange(6, 1).setValue("Baseline Cost:");
    dashSheet.getRange(6, 2).setValue("$" + summary.totalBaselineCost);

    dashSheet.getRange(7, 1).setValue("Optimized Cost:");
    dashSheet.getRange(7, 2).setValue("$" + summary.totalOptimizedCost);

    dashSheet.getRange(8, 1).setValue("Monthly Savings:");
    dashSheet.getRange(8, 2).setValue("$" + summary.totalSavings);
    dashSheet.getRange(8, 2).setFontWeight("bold").setBackground("#90ee90");

    dashSheet.getRange(9, 1).setValue("Savings %:");
    dashSheet.getRange(9, 2).setValue(summary.savingsPercentage + "%");
    dashSheet.getRange(9, 2).setFontWeight("bold").setFontColor("green");

    // Performance section
    dashSheet.getRange(11, 1).setValue("⚡ Performance");
    dashSheet.getRange(11, 1).setFontWeight("bold").setBackground("#e3f2fd");

    dashSheet.getRange(12, 1).setValue("Days Tracked:");
    dashSheet.getRange(12, 2).setValue(summary.daysTracked);

    dashSheet.getRange(13, 1).setValue("Total Appointments:");
    dashSheet.getRange(13, 2).setValue(summary.totalAppointments);

    dashSheet.getRange(14, 1).setValue("Avg Cache Hit Rate:");
    dashSheet.getRange(14, 2).setValue(summary.avgCacheHitRate + "%");

    // Auto-resize
    dashSheet.setColumnWidth(1, 200);
    dashSheet.setColumnWidth(2, 150);

    Logger.log("Visual dashboard created");

    return { success: true };
}



// ========================================================
// SETUP EVERYTHING AT ONCE
// ========================================================

function setupMonitoringDashboard() {

    const ui = SpreadsheetApp.getUi();

    try {

        // Initialize dashboard sheet
        initializeMonitoringDashboard();

        // Setup daily logging trigger
        setupDailyMetricsLogging();

        // Log first day's metrics
        logDailyMetrics();

        // Create visual dashboard
        createVisualDashboard();

        ui.alert(
            "✅ MONITORING DASHBOARD SETUP COMPLETE!\n\n" +
            "📊 Dashboard sheet created\n" +
            "📊 Cost_Dashboard sheet created\n" +
            "⏰ Daily logging enabled (11 PM UTC)\n" +
            "📈 First metrics logged\n\n" +
            "Your costs and metrics are now being tracked automatically!"
        );

    } catch (error) {

        ui.alert("❌ Error: " + error.message);
    }
}
