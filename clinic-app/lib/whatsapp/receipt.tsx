import { ImageResponse } from "next/og";

/**
 * Generates the shareable appointment receipt card as a PNG, replacing
 * src/Model_Appointments.gs's createAppointmentReceiptCardBlob — that
 * version built a throwaway Google Slide and exported it as an image
 * (the only way to rasterize a layout from Apps Script); Next.js ships
 * this capability directly via `next/og`'s ImageResponse (Satori +
 * resvg, no extra dependency, no native binary to compile — works the
 * same in a Vercel deploy or the Docker image).
 *
 * No clinic logo (the Apps Script version pulled one from a hardcoded
 * Google Drive file id — there's no equivalent asset source here yet).
 * Worth revisiting if a clinic wants branding on the card; see
 * clinic-app/README.md.
 */

export interface AppointmentReceiptDetails {
  clinicName: string;
  patientName: string;
  doctorName: string;
  specialization: string;
  date: string; // "YYYY-MM-DD"
  time: string; // display label, e.g. "9:00 AM"
  appointmentCode: string;
}

const ROW_LABEL_COLOR = "#777777";
const ROW_VALUE_COLOR = "#222222";

function ReceiptRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div style={{ display: "flex", width: "100%", marginBottom: 18 }}>
      <div style={{ width: 220, fontSize: 15, fontWeight: 700, color: ROW_LABEL_COLOR, letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: emphasize ? 700 : 400, color: ROW_VALUE_COLOR }}>
        {value || "—"}
      </div>
    </div>
  );
}

export function renderAppointmentReceiptImage(details: AppointmentReceiptDetails): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#FFFFFF",
          fontFamily: "sans-serif"
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            height: 150,
            padding: "0 48px",
            backgroundColor: "#0B6E4F"
          }}
        >
          <div style={{ fontSize: 36, fontWeight: 700, color: "#FFFFFF" }}>{details.clinicName}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", marginTop: 6, letterSpacing: 2 }}>
            APPOINTMENT CONFIRMED
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "40px 48px", flex: 1 }}>
          <ReceiptRow label="PATIENT" value={details.patientName} />
          <ReceiptRow label="DOCTOR" value={details.doctorName} />
          <ReceiptRow label="SPECIALIZATION" value={details.specialization} />
          <ReceiptRow label="DATE" value={details.date} />
          <ReceiptRow label="TIME" value={details.time} />
          <ReceiptRow label="APPOINTMENT ID" value={details.appointmentCode} emphasize />
          <ReceiptRow label="CLINIC" value={details.clinicName} />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid #DDDDDD",
            padding: "20px 48px",
            fontSize: 15,
            color: "#666666"
          }}
        >
          <div>Please show this confirmation at reception.</div>
          <div>You can forward this card to the patient.</div>
        </div>
      </div>
    ),
    { width: 900, height: 620 }
  );
}

/** Convenience wrapper — most callers just want the PNG bytes to upload, not the Response object itself. */
export async function generateAppointmentReceiptImageBuffer(
  details: AppointmentReceiptDetails
): Promise<Buffer> {
  const response = renderAppointmentReceiptImage(details);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
