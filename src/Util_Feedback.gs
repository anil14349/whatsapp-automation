// ============================================================
// Util_Feedback — part of the ABC Clinic WhatsApp bot
// Post-appointment feedback and ratings collection
// ============================================================



function ensureFeedbackSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Feedback");

    if (!sheet) {

        sheet = ss.insertSheet("Feedback");

        sheet.appendRow([
            "Appointment ID",
            "Patient Phone",
            "Patient Name",
            "Doctor Name",
            "Rating",
            "Comments",
            "Submitted At",
            "Status"
        ]);

        sheet.hideSheet();
    }

    return sheet;
}



// Send feedback survey to patient (post-appointment)
// Returns: {success: bool, message: string}
function sendFeedbackSurvey(
    appointmentId,
    patientPhone,
    patientName,
    doctorName
) {

    if (
        !appointmentId || !patientPhone ||
        !doctorName
    ) {

        return {
            success: false,
            message: "Missing required information"
        };
    }

    const message =
        "⭐ *We'd love your feedback!*\n\n" +
        "How was your experience with " +
        "Dr. " + doctorName + "?\n\n" +
        "Please rate 1-5 stars:\n" +
        "1️⃣ Poor\n" +
        "2️⃣ Fair\n" +
        "3️⃣ Good\n" +
        "4️⃣ Very Good\n" +
        "5️⃣ Excellent\n\n" +
        "(Just reply with the number)";

    try {

        sendWhatsAppTextMessage(
            patientPhone,
            message
        );

        // Queue for feedback tracking
        const sheet = ensureFeedbackSheet();

        sheet.appendRow([
            String(appointmentId).trim(),
            String(patientPhone).trim(),
            String(patientName || "").trim(),
            String(doctorName).trim(),
            "",
            "",
            new Date(),
            "PENDING"
        ]);

        return {
            success: true,
            message: "Feedback survey sent"
        };

    } catch (error) {

        Logger.log(
            "Failed to send feedback: " +
            error.message
        );

        return {
            success: false,
            message: "Failed to send feedback"
        };
    }
}



// Record feedback (rating only)
function recordFeedbackRating(
    appointmentId,
    patientPhone,
    rating
) {

    if (
        !appointmentId || !patientPhone ||
        !rating
    ) {

        return false;
    }

    const ratingNum = Number(rating);

    if (ratingNum < 1 || ratingNum > 5) {
        return false;
    }

    const sheet = ensureFeedbackSheet();

    const data = sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(appointmentId).trim() &&
            phonesMatch(data[i][1], patientPhone)
        ) {

            sheet.getRange(i + 1, 5).setValue(
                ratingNum
            );

            sheet.getRange(i + 1, 8).setValue(
                "RATED"
            );

            return true;
        }
    }

    return false;
}



// Record feedback with comments
function recordFeedbackWithComments(
    appointmentId,
    patientPhone,
    rating,
    comments
) {

    if (
        !appointmentId || !patientPhone ||
        !rating
    ) {

        return false;
    }

    const ratingNum = Number(rating);

    if (ratingNum < 1 || ratingNum > 5) {
        return false;
    }

    const sheet = ensureFeedbackSheet();

    const data = sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(appointmentId).trim() &&
            phonesMatch(data[i][1], patientPhone)
        ) {

            sheet.getRange(i + 1, 5).setValue(
                ratingNum
            );

            if (comments) {
                sheet.getRange(i + 1, 6).setValue(
                    String(comments).trim()
                );
            }

            sheet.getRange(i + 1, 8).setValue(
                "COMPLETE"
            );

            return true;
        }
    }

    return false;
}



// Get doctor's average rating
function getDoctorAverageRating(doctorId) {

    if (!doctorId) {
        return null;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Feedback");

    if (!sheet) {
        return null;
    }

    const data = sheet.getDataRange().getValues();

    let totalRating = 0;
    let count = 0;

    // ========================================================
    // GET DOCTOR ONCE (outside loop)
    // ========================================================
    // getDoctorRecord loads entire Doctors sheet;
    // fetch once instead of per-feedback-row to avoid O(n²)

    const doctor =
        getDoctorRecord(doctorId);

    if (!doctor) {
        return null;
    }

    const doctorNameToMatch =
        doctor.doctorName;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const doctorName =
            String(data[i][3] || "").trim();

        const rating = Number(data[i][4] || 0);

        if (
            doctorName === doctorNameToMatch &&
            rating > 0
        ) {

            totalRating += rating;
            count++;
        }
    }

    if (count === 0) {
        return null;
    }

    const avgRating = (totalRating / count).toFixed(1);

    return {
        rating: Number(avgRating),
        count: count
    };
}



// Get doctor's recent feedback
function getDoctorRecentFeedback(doctorId, limit) {

    if (!doctorId) {
        return [];
    }

    const feedbackLimit = limit || 5;

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Feedback");

    if (!sheet) {
        return [];
    }

    const data = sheet.getDataRange().getValues();

    const feedback = [];

    const doctor = getDoctorRecord(doctorId);

    if (!doctor) {
        return [];
    }

    // Scan backwards for most recent
    for (
        let i = data.length - 1;
        i >= 1 && feedback.length < feedbackLimit;
        i--
    ) {

        const doctorName =
            String(data[i][3] || "").trim();

        const rating = Number(data[i][4] || 0);

        const comments =
            String(data[i][5] || "").trim();

        if (
            doctorName === doctor.doctorName &&
            rating > 0
        ) {

            feedback.push({
                rating: rating,
                comments: comments,
                submittedAt: data[i][6]
            });
        }
    }

    return feedback;
}



// Build feedback display for doctor profile
function formatDoctorFeedbackMessage(doctorId) {

    const avgRating = getDoctorAverageRating(doctorId);

    if (!avgRating) {
        return "";
    }

    const stars =
        "⭐".repeat(Math.round(avgRating.rating));

    return (
        stars + " " +
        avgRating.rating +
        " (" + avgRating.count + " reviews)\n"
    );
}
