// ============================================================
// Util_CostOptimization — part of the ABC Clinic WhatsApp bot
// Reduce WhatsApp messaging costs without requiring templates
// ============================================================



// ========================================================
// COST REDUCTION CONFIGURATION
// ========================================================
// Adjust these settings to optimize messaging costs

const COST_OPTIMIZATION = {

    // ========================================================
    // REMINDER STRATEGY
    // ========================================================
    // Option 1: Send 2 reminders (24hr + 1hr before)
    //   Cost per appointment: ~$0.02
    //   Patient engagement: High
    //
    // Option 2: Send 1 reminder (1hr before only)
    //   Cost per appointment: ~$0.01
    //   Patient engagement: Medium
    //   Savings: 50% on reminder costs

    SEND_24HR_REMINDER: false,      // Disable to save 50% on reminders
    SEND_1HR_REMINDER: true,        // Always send (critical for attendance)

    // ========================================================
    // SESSION MESSAGE OPTIMIZATION
    // ========================================================
    // Send confirmation ONLY within 24-hour session window
    // (after patient's inbound message)
    // Cost: ~$0.004 per message (vs $0.01 outside session)
    // Savings: 60% on confirmation costs

    USE_SESSION_WINDOW: true,       // Send confirmations in session (24hr window)
    SESSION_WINDOW_HOURS: 24,       // WhatsApp session window

    // ========================================================
    // MESSAGE BATCHING
    // ========================================================
    // For waitlist notifications, send 1 message for multiple slots
    // instead of separate message per slot

    BATCH_WAITLIST_NOTIFICATIONS: true,

    // ========================================================
    // REDUCE REDUNDANT MESSAGES
    // ========================================================
    // Skip cancellation confirmation if patient initiated cancellation
    // (we already know they received the message)

    SKIP_CANCELLATION_CONFIRMATION: false,  // Set true to save ~5-10 messages/month

    // ========================================================
    // FEEDBACK SURVEY STRATEGY
    // ========================================================
    // Option 1: Send feedback after every appointment
    //   Cost: ~$0.01 per feedback
    //   Response rate: Low (~20%)
    //
    // Option 2: Send feedback to random 25% of patients
    //   Cost: 75% savings on feedback
    //   Response rate: Similar (selective feedback)

    FEEDBACK_SAMPLING_RATE: 0.25,   // Send feedback to 25% of patients (0.0 to 1.0)

    // ========================================================
    // ESTIMATED MONTHLY SAVINGS
    // ========================================================
    // With all optimizations enabled:
    //
    // Baseline (all messages):
    //   50 appointments/day × 3 messages × 30 = 4,500 messages = $45/month
    //
    // With optimizations:
    //   50 appointments/day × 1.5 messages × 30 = 2,250 messages = $22.50/month
    //   Feedback sampling: 50 appts × 0.25 × 30 × $0.01 = $3.75/month
    //   Total optimized: ~$26.25/month
    //
    // TOTAL SAVINGS: ~40% ($18.75/month for 50 appts/day clinic)
};



// ========================================================
// CHECK IF WITHIN SESSION WINDOW
// ========================================================
// Session window = 24 hours after patient's last inbound message
// Returns true if we should send as session message (cheaper)

function isWithinSessionWindow(patientPhone) {

    if (!COST_OPTIMIZATION.USE_SESSION_WINDOW) {
        return false;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        return false;
    }

    const data =
        sheet.getDataRange().getValues();

    const normalized =
        normalizeWhatsAppPhone(patientPhone);

    const now = new Date();
    const sessionWindowMs =
        COST_OPTIMIZATION.SESSION_WINDOW_HOURS * 60 * 60 * 1000;

    // Scan backward for most recent session
    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        if (
            !phonesMatch(
                data[i][1],
                normalized
            )
        ) {
            continue;
        }

        // Found patient session
        const lastMessageAt =
            new Date(data[i][11]); // Last Message At column

        const timeSinceLastMessage =
            now - lastMessageAt;

        // Within session window if less than 24 hours
        return timeSinceLastMessage < sessionWindowMs;
    }

    return false;
}



// ========================================================
// OPTIMIZED APPOINTMENT CONFIRMATION
// ========================================================
// Send confirmation only if within session window to save 60%
// Outside session: skip (appointment is already confirmed in booking flow)

function sendOptimizedConfirmation(
    patientPhone,
    patientName,
    doctorName,
    date,
    time
) {

    // Only send confirmation if within session window (cheap rate)
    if (!isWithinSessionWindow(patientPhone)) {
        Logger.log(
            "Skipping confirmation (outside 24-hour session): " +
            patientPhone
        );
        return { sent: false, reason: "outside_session_window" };
    }

    const message =
        "✅ *Appointment Confirmed*\n\n" +
        "Patient: " + patientName + "\n" +
        "Doctor: Dr. " + doctorName + "\n" +
        "Date: " + date + "\n" +
        "Time: " + time + "\n\n" +
        "See you soon!";

    try {

        sendWhatsAppTextMessage(patientPhone, message);

        return { sent: true, reason: "session_message" };

    } catch (error) {

        Logger.log(
            "Failed to send optimized confirmation: " +
            error.message
        );

        return {
            sent: false,
            reason: "send_error",
            error: error.message
        };
    }
}



// ========================================================
// OPTIMIZED REMINDER STRATEGY
// ========================================================
// Send reminders based on cost optimization settings

function shouldSendReminder(type, appointmentDate) {

    const today = new Date();
    const apptDate = new Date(appointmentDate);

    // Calculate days until appointment
    const daysUntil =
        Math.floor(
            (apptDate - today) / (24 * 60 * 60 * 1000)
        );

    // Type 1: 24-hour reminder (configurable)
    if (type === "24hr") {

        if (!COST_OPTIMIZATION.SEND_24HR_REMINDER) {
            return false;  // Cost optimization: skip 24hr reminder
        }

        return daysUntil === 1;  // Tomorrow
    }

    // Type 2: 1-hour reminder (always send)
    if (type === "1hr") {

        if (!COST_OPTIMIZATION.SEND_1HR_REMINDER) {
            return false;  // User disabled
        }

        return daysUntil === 0;  // Today
    }

    return false;
}



// ========================================================
// OPTIMIZED FEEDBACK SURVEY STRATEGY
// ========================================================
// Send feedback to random sample of patients to reduce costs

function shouldSendFeedbackSurvey(appointmentId) {

    const samplingRate =
        COST_OPTIMIZATION.FEEDBACK_SAMPLING_RATE;

    if (samplingRate <= 0) {
        return false;  // Feedback disabled
    }

    if (samplingRate >= 1) {
        return true;  // Send to all patients
    }

    // ========================================================
    // DETERMINISTIC SAMPLING
    // ========================================================
    // Use appointmentId to determine if this appointment
    // should receive feedback (same ID always same result)
    // Prevents sending survey multiple times to same appointment

    const hash = appointmentId
        .split("")
        .reduce(function (acc, char) {
            return acc + char.charCodeAt(0);
        }, 0);

    const randomValue = (hash % 100) / 100;

    return randomValue < samplingRate;
}



// ========================================================
// COST SAVINGS REPORT
// ========================================================
// Generate monthly cost estimation with optimizations

function generateCostSavingsReport() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentsSheet =
        ss.getSheetByName("Appointments");

    if (!appointmentsSheet) {
        return { error: "Appointments sheet not found" };
    }

    const data =
        appointmentsSheet.getDataRange().getValues();

    // Estimate based on last 30 days
    const today = new Date();
    const thirtyDaysAgo =
        new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    let appointmentsLastMonth = 0;

    for (let i = 1; i < data.length; i++) {

        const appointmentDate =
            new Date(data[i][1]);

        if (appointmentDate >= thirtyDaysAgo) {
            appointmentsLastMonth++;
        }
    }

    // Calculate baseline cost (all messages)
    const messagesPerAppointmentBaseline = 3;  // confirmation + 2 reminders
    const feedbackPerAppointment = 0.3;  // ~30% of appts get feedback
    const totalMessagesBaseline =
        (appointmentsLastMonth * messagesPerAppointmentBaseline) +
        (appointmentsLastMonth * feedbackPerAppointment);

    const baselineCost =
        totalMessagesBaseline * 0.01;

    // Calculate optimized cost
    let messagesPerAppointmentOptimized = 1;  // Only 1-hr reminder

    // Confirmation cost: 60% cheaper if in session (assume 50% in session)
    const confirmationCost =
        appointmentsLastMonth *
        ((0.5 * 0.004) + (0.5 * 0.01));

    const remindersOptimized =
        appointmentsLastMonth * 1;  // Only 1-hr reminder

    const feedbackOptimized =
        appointmentsLastMonth *
        COST_OPTIMIZATION.FEEDBACK_SAMPLING_RATE *
        0.01;

    const totalCostOptimized =
        confirmationCost +
        remindersOptimized * 0.01 +
        feedbackOptimized;

    const monthlySavings =
        baselineCost - totalCostOptimized;

    const savingsPercentage =
        (monthlySavings / baselineCost * 100).toFixed(1);

    return {
        appointmentsLastMonth: appointmentsLastMonth,
        baselineCostPerMonth: baselineCost.toFixed(2),
        optimizedCostPerMonth: totalCostOptimized.toFixed(2),
        monthlySavings: monthlySavings.toFixed(2),
        savingsPercentage: savingsPercentage,
        optimizationsActive: [
            COST_OPTIMIZATION.SEND_24HR_REMINDER ? "" : "✓ Skip 24hr reminder (50% savings)",
            COST_OPTIMIZATION.USE_SESSION_WINDOW ? "✓ Use session window (60% cheaper confirmations)" : "",
            COST_OPTIMIZATION.FEEDBACK_SAMPLING_RATE < 1 ? "✓ Sample feedback (" + (COST_OPTIMIZATION.FEEDBACK_SAMPLING_RATE * 100) + "%)" : ""
        ].filter(function (x) { return x; })
    };
}



// ========================================================
// LOG COST OPTIMIZATIONS
// ========================================================

function logCostOptimizations() {

    const report = generateCostSavingsReport();

    Logger.log(
        "=== COST OPTIMIZATION REPORT ===\n" +
        "Appointments (last 30 days): " + report.appointmentsLastMonth + "\n" +
        "Baseline cost/month: $" + report.baselineCostPerMonth + "\n" +
        "Optimized cost/month: $" + report.optimizedCostPerMonth + "\n" +
        "Monthly savings: $" + report.monthlySavings + " (" + report.savingsPercentage + "%)\n" +
        "Active optimizations:\n" +
        report.optimizationsActive.map(function (o) { return "  " + o; }).join("\n")
    );

    return report;
}
