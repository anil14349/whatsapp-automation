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

            return getAvailableSlots(
                data.doctorId,
                data.date
            );


        // --------------------------------------------------------
        // BOOK
        // --------------------------------------------------------

        case "book":

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

            return getMyAppointments(
                data.patientPhone
            );


        // --------------------------------------------------------
        // CANCEL - SECURE
        // --------------------------------------------------------

        case "cancel":

            return cancelAppointment(

                data.appointmentId,

                data.patientPhone
            );


        // --------------------------------------------------------
        // RESCHEDULE - SECURE
        // --------------------------------------------------------

        case "reschedule":

            return rescheduleAppointment(

                data.appointmentId,

                data.patientPhone,

                data.newDate,

                data.newTime
            );


        case "doctorToday":

            return getDoctorTodaySchedule(
                data.doctorId
            );

        case "doctorWeek":

            return getDoctorWeeklySchedule(
                data.doctorId
            );

        case "doctorNext":

            return getDoctorNextAppointment(
                data.doctorId
            );

        case "doctorPatients":

            return {
                success: true,
                patients:
                    getDoctorPatientsSeen(
                        data.doctorId
                    )
            };

        case "doctorAvailability":

            return {
                success: true,
                availability:
                    getDoctorWeeklyAvailability(
                        data.doctorId
                    )
            };

        case "doctorLeaves":

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
