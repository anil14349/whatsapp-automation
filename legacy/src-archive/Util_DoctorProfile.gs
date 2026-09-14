// ============================================================
// Util_DoctorProfile — part of the ABC Clinic WhatsApp bot
// Enhanced doctor profiles with specialization, qualifications, ratings
// ============================================================



// Get or create Doctors sheet columns for enhanced profiles
function ensureDoctorProfileColumns() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return false;
    }

    const headers =
        sheet.getRange(1, 1, 1, 20).getValues()[0];

    const headerMap = {};
    for (let i = 0; i < headers.length; i++) {
        headerMap[String(headers[i]).trim().toLowerCase()] =
            i + 1;
    }

    // Ensure columns exist
    const columnsNeeded = {
        "specialty": 7,
        "qualifications": 8,
        "yearsexperience": 9,
        "languages": 10,
        "rating": 11,
        "reviewcount": 12
    };

    let maxCol = Math.max(...Object.values(columnsNeeded));

    // Add headers if missing
    if (!headerMap["specialty"]) {
        sheet.getRange(1, 7).setValue("Specialty");
    }

    if (!headerMap["qualifications"]) {
        sheet.getRange(1, 8).setValue("Qualifications");
    }

    if (!headerMap["yearsexperience"]) {
        sheet.getRange(1, 9).setValue("Years Experience");
    }

    if (!headerMap["languages"]) {
        sheet.getRange(1, 10).setValue("Languages");
    }

    if (!headerMap["rating"]) {
        sheet.getRange(1, 11).setValue("Rating");
    }

    if (!headerMap["reviewcount"]) {
        sheet.getRange(1, 12).setValue("Review Count");
    }

    return true;
}



// Get extended doctor profile with specialty, qualifications, rating
function getDoctorProfile(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return null;
    }

    // ========================================================
    // LOAD SHEET ONCE
    // ========================================================
    // Search sheet for doctor and build complete profile
    // (avoids redundant getDoctorRecord call which loads sheet again)

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            return {
                doctorId:
                    String(data[i][0]).trim(),

                doctorName:
                    String(data[i][1] || "").trim(),

                phone:
                    String(data[i][2] || "").trim(),

                clinicName:
                    String(data[i][3] || "").trim(),

                calendarId:
                    String(data[i][4] || "").trim(),

                qualificationId:
                    String(data[i][5] || "").trim(),

                specialty:
                    String(data[i][6] || "").trim(),

                qualifications:
                    String(data[i][7] || "").trim(),

                yearsExperience:
                    Number(data[i][8] || 0),

                languages:
                    String(data[i][9] || "").trim(),

                rating:
                    Number(data[i][10] || 0),

                reviewCount:
                    Number(data[i][11] || 0)
            };
        }
    }

    return null;
}



// Format doctor profile as WhatsApp message
function formatDoctorProfileMessage(doctorId, includeSlots) {

    const doctor = getDoctorProfile(doctorId);

    if (!doctor) {
        return "Doctor not found.";
    }

    let message =
        "👨‍⚕️ *" + doctor.doctorName + "*\n";

    if (doctor.specialty) {
        message += "📋 " + doctor.specialty + "\n";
    }

    if (doctor.qualifications) {
        message +=
            "🎓 " + doctor.qualifications + "\n";
    }

    if (doctor.yearsExperience > 0) {
        message +=
            "📅 " + doctor.yearsExperience +
            " years experience\n";
    }

    if (doctor.languages) {
        message +=
            "🗣️ " + doctor.languages + "\n";
    }

    if (
        doctor.rating > 0 &&
        doctor.reviewCount > 0
    ) {

        const stars =
            "⭐".repeat(
                Math.round(doctor.rating)
            );

        message +=
            stars + " " +
            doctor.rating.toFixed(1) +
            " (" + doctor.reviewCount +
            " reviews)\n";
    }

    if (includeSlots) {
        message += "\n📅 *Available Slots*\n";
    }

    return message;
}



// Get all doctors with profiles for selection
function getAllDoctorProfiles() {

    const doctors = getDoctors();
    const profiles = [];

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        const profile =
            getDoctorProfile(doctors[i].doctorId);

        if (profile) {
            profiles.push(profile);
        }
    }

    return profiles;
}



// Build doctor selection menu with profiles
function buildDoctorSelectionWithProfiles() {

    const doctors = getAllDoctorProfiles();

    if (doctors.length === 0) {
        return null;
    }

    const menuItems = [];

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        const doc = doctors[i];

        let title =
            doc.doctorName || "Unknown";

        if (doc.specialty) {
            title += " - " + doc.specialty;
        }

        let description =
            doc.qualifications || "";

        if (
            doc.yearsExperience > 0
        ) {

            if (description) {
                description += " | ";
            }

            description +=
                doc.yearsExperience +
                " years";
        }

        menuItems.push({
            id: String(doc.doctorId || i + 1),
            title: title,
            description: description
        });
    }

    return menuItems;
}
