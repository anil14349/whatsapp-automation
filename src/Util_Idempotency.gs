// ============================================================
// Util_Idempotency — part of the ABC Clinic WhatsApp bot
// Persistent message deduplication using sheet-based tracking
// instead of cache with TTL to prevent duplicate processing
// after cache expiration.
// ============================================================


function ensureIdempotencySheet() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Message_Deduplication");

    if (!sheet) {
        sheet = ss.insertSheet("Message_Deduplication");
        sheet.appendRow([
            "Message ID",
            "Phone",
            "Processed At",
            "Status",
            "Expires At"
        ]);
        // Hide this operational sheet
        sheet.hideSheet();
    }

    return sheet;
}


// Check if message was already processed within retention window
// Returns: {isProcessed: bool, isExpired: bool, lastProcessedAt: date}
function checkMessageIdempotency(messageId) {

    if (!messageId) {
        return { isProcessed: false, isExpired: false };
    }

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const retentionMs = 7 * 24 * 60 * 60 * 1000;  // 7 days retention

    for (let i = 1; i < data.length; i++) {
        const rowMessageId = String(data[i][0] || "").trim();

        if (rowMessageId !== String(messageId).trim()) {
            continue;
        }

        const processedAt = new Date(data[i][2]);
        const expiresAt = new Date(data[i][4]);
        const age = now - processedAt;

        return {
            isProcessed: true,
            isExpired: age > retentionMs,
            lastProcessedAt: processedAt,
            status: String(data[i][3] || ""),
            row: i + 1
        };
    }

    return { isProcessed: false, isExpired: false };
}


// Record that a message is being processed
function recordMessageProcessing(messageId, phone) {

    if (!messageId) {
        return false;
    }

    const sheet = ensureIdempotencySheet();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    sheet.appendRow([
        String(messageId).trim(),
        String(phone || "").trim(),
        now,
        "PROCESSING",
        expiresAt
    ]);

    return true;
}


// Mark message processing as complete
function markMessageProcessed(messageId, status) {

    if (!messageId) {
        return false;
    }

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        const rowMessageId = String(data[i][0] || "").trim();

        if (rowMessageId === String(messageId).trim()) {
            sheet.getRange(i + 1, 4).setValue(status || "SUCCESS");
            return true;
        }
    }

    return false;
}


// Clean up expired deduplication records (call periodically)
function cleanupExpiredDeduplicationRecords() {

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const rowsToDelete = [];

    for (let i = data.length - 1; i >= 1; i--) {
        const expiresAt = new Date(data[i][4]);

        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }

    // Delete in reverse order to maintain row numbers
    for (const row of rowsToDelete) {
        sheet.deleteRow(row);
    }

    return rowsToDelete.length;
}
