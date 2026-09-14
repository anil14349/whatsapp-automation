// ============================================================
// Api — part of the ABC Clinic WhatsApp bot
// api() HTTP-style dispatcher used by external callers (dashboards, etc.).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// 11. UNIFIED API
// ============================================================

function api(
    action,
    data
) {

    if (!data || typeof data !== "object") {
        data = {};
    }

    switch (action) {

        // --------------------------------------------------------
        // GET DOCTORS
        // --------------------------------------------------------

        case "getDoctors":

            return getDoctors();


        // --------------------------------------------------------
        // GET AVAILABLE SLOTS
        // --------------------------------------------------------

        case "getAvailableSlots":

            if (!data.doctorId || !data.date) {
                return {
                    success: false,
                    message: "Missing required parameters: doctorId and date"
                };
            }

            return getAvailableSlots(
                data.doctorId,
                data.date
            );


        // --------------------------------------------------------
        // BOOK
        // --------------------------------------------------------

        case "book":

            if (!data.doctorId || !data.date || !data.time ||
                !data.patientName || !data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameters: doctorId, date, time, patientName, patientPhone"
                };
            }

            return bookAppointment(

                data.doctorId,

                data.date,

                data.time,

                data.patientName,

                data.patientPhone,

                data.patientLanguage
            );


        // --------------------------------------------------------
        // GET PATIENT APPOINTMENTS
        // --------------------------------------------------------

        case "getMyAppointments":

            if (!data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameter: patientPhone"
                };
            }

            return getMyAppointments(
                data.patientPhone
            );


        // --------------------------------------------------------
        // CANCEL - SECURE
        // --------------------------------------------------------

        case "cancel":

            if (!data.appointmentId || !data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameters: appointmentId, patientPhone"
                };
            }

            return cancelAppointment(

                data.appointmentId,

                data.patientPhone
            );


        // --------------------------------------------------------
        // RESCHEDULE - SECURE
        // --------------------------------------------------------

        case "reschedule":

            if (!data.appointmentId || !data.patientPhone ||
                !data.newDate || !data.newTime) {
                return {
                    success: false,
                    message: "Missing required parameters: appointmentId, patientPhone, newDate, newTime"
                };
            }

            return rescheduleAppointment(

                data.appointmentId,

                data.patientPhone,

                data.newDate,

                data.newTime
            );


        case "doctorToday":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorTodaySchedule(
                data.doctorId
            );

        case "doctorWeek":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorWeeklySchedule(
                data.doctorId
            );

        case "doctorNext":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorNextAppointment(
                data.doctorId
            );

        case "doctorPatients":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return {
                success: true,
                patients:
                    getDoctorPatientsSeen(
                        data.doctorId
                    )
            };

        case "doctorAvailability":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return {
                success: true,
                availability:
                    getDoctorWeeklyAvailability(
                        data.doctorId
                    )
            };

        case "doctorLeaves":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return {
                success: true,
                leaves:
                    getDoctorUpcomingLeaves(
                        data.doctorId
                    )
            };

        // --------------------------------------------------------
        // UNKNOWN ACTION
        // --------------------------------------------------------

        default:

            return {

                success: false,

                message:
                    "Unknown action."
            };
    }
}
