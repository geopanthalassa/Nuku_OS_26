// Envío de emails transaccionales vía Brevo (API REST, v3/smtp/email).
//
// Requiere la variable de entorno BREVO_API_KEY en el proyecto de Vercel
// (nuku-os-app). Andre la agrega él mismo en Vercel → Settings →
// Environment Variables, con el valor real de su cuenta de Brevo (Settings
// → SMTP & API → API Keys, en el dashboard de Brevo) — el valor de esa
// clave nunca debe pasar por este chat ni ser escrito por Claude.
//
// Remitente verificado en la cuenta de Brevo de Kuhane (confirmado vía la
// API de Brevo, 23/9/2026): "Kuhane Etno-Hostal" <kuhanehostal@gmail.com>.
//
// Si BREVO_API_KEY no está configurada todavía, sendTransactionalEmail no
// revienta el flujo que la llama — deja un log de advertencia y devuelve
// { sent: false }. Así la reserva se sigue guardando aunque el email
// todavía no esté conectado en producción.

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER = { name: "Kuhane Etno-Hostal", email: "kuhanehostal@gmail.com" };

export async function sendTransactionalEmail(opts: {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
}): Promise<{ sent: boolean; reason?: string; status?: number }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("[email] BREVO_API_KEY no configurada — no se envió el correo a", opts.to.email);
    return { sent: false, reason: "missing_api_key" };
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: SENDER,
        to: [opts.to],
        subject: opts.subject,
        htmlContent: opts.htmlContent,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Brevo respondió con error", res.status, text);
      return { sent: false, reason: "brevo_error", status: res.status };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email] fallo de red al llamar a Brevo", err);
    return { sent: false, reason: "network_error" };
  }
}

function formatDateLong(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Persona (titular o acompañante) tal como llega el body de
// /api/reservations/request — se reusa para armar el correo interno.
type PersonForEmail = {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  document_id?: string | null;
  nationality?: string | null;
  dietary_vegan?: boolean;
  dietary_vegetarian?: boolean;
  dietary_celiac?: boolean;
  dietary_lactose_free?: boolean;
  dietary_other?: string | null;
  mobility_assistance?: boolean;
  mobility_notes?: string | null;
};

// Junta las preferencias alimentarias y de movilidad de una persona en una
// sola línea legible, o null si no marcó nada especial.
function dietaryLine(p: PersonForEmail): string | null {
  const items: string[] = [];
  if (p.dietary_vegan) items.push("Vegano");
  if (p.dietary_vegetarian) items.push("Vegetariano");
  if (p.dietary_celiac) items.push("Celíaco");
  if (p.dietary_lactose_free) items.push("Sin lactosa");
  if (p.dietary_other) items.push(p.dietary_other);
  if (p.mobility_assistance) items.push(`Asistencia de movilidad${p.mobility_notes ? `: ${p.mobility_notes}` : ""}`);
  return items.length > 0 ? items.join(", ") : null;
}

function personRow(p: PersonForEmail, label: string) {
  const dietary = dietaryLine(p);
  const details = [
    p.document_id ? `Doc: ${escapeHtml(p.document_id)}` : null,
    p.nationality ? `Nacionalidad: ${escapeHtml(p.nationality)}` : null,
    p.birth_date ? `F. nac.: ${formatDateLong(p.birth_date)}` : null,
    p.phone ? `Tel.: ${escapeHtml(p.phone)}` : null,
    p.email ? `Email: ${escapeHtml(p.email)}` : null,
    dietary ? `Dieta/movilidad: ${escapeHtml(dietary)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #e8e3d9; vertical-align: top;">
        <div><strong>${escapeHtml(p.full_name ?? "[POR CONFIRMAR]")}</strong> <span style="color: #6b645c; font-size: 12px;">(${label})</span></div>
        ${details ? `<div style="color: #6b645c; font-size: 13px; margin-top: 2px;">${details}</div>` : ""}
      </td>
    </tr>
  `;
}

// Correo interno a Kuhane con el detalle completo de cada solicitud de
// reserva — pedido de Andre (23/9/2026): "apenas diga reservar habitación
// debe generarse un correo a kuhane con toda la información además de
// todos los datos dentro de nuku OS". Nuku OS ya guarda todo esto (es la
// fuente de verdad), este correo es solo un aviso inmediato para no tener
// que entrar al panel a cada rato.
export function internalReservationNotificationEmail(params: {
  reservationId: string;
  guest: PersonForEmail;
  companions: PersonForEmail[];
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  tourInterest: boolean;
  tourNotes?: string | null;
  promoCode?: string | null;
  arrivalFlightTime?: string | null;
  arrivalFlightNumber?: string | null;
  departureFlightTime?: string | null;
  departureFlightNumber?: string | null;
}) {
  const {
    reservationId,
    guest,
    companions,
    roomName,
    checkIn,
    checkOut,
    nights,
    tourInterest,
    tourNotes,
    promoCode,
    arrivalFlightTime,
    arrivalFlightNumber,
    departureFlightTime,
    departureFlightNumber,
  } = params;

  const subject = `Nueva solicitud de reserva — ${escapeHtml(guest.full_name ?? "[POR CONFIRMAR]")} — ${formatDateLong(checkIn)} al ${formatDateLong(checkOut)}`;

  const flightRows = [
    arrivalFlightTime || arrivalFlightNumber
      ? `<tr><td style="padding: 6px 0; color: #6b645c;">Vuelo de llegada</td><td style="padding: 6px 0; text-align: right;">${
          escapeHtml([arrivalFlightNumber, arrivalFlightTime].filter(Boolean).join(" · ")) || "—"
        }</td></tr>`
      : "",
    departureFlightTime || departureFlightNumber
      ? `<tr><td style="padding: 6px 0; color: #6b645c;">Vuelo de salida</td><td style="padding: 6px 0; text-align: right;">${
          escapeHtml([departureFlightNumber, departureFlightTime].filter(Boolean).join(" · ")) || "—"
        }</td></tr>`
      : "",
  ].join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2f2b26;">
      <h1 style="font-size: 20px; color: #1f4b43;">Nueva solicitud de reserva</h1>
      <p style="color: #6b645c; font-size: 13px;">ID reserva: ${escapeHtml(reservationId)}</p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 6px 0; color: #6b645c;">Habitación</td><td style="padding: 6px 0; text-align: right;"><strong>${escapeHtml(roomName)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Llegada</td><td style="padding: 6px 0; text-align: right;">${formatDateLong(checkIn)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Salida</td><td style="padding: 6px 0; text-align: right;">${formatDateLong(checkOut)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Noches</td><td style="padding: 6px 0; text-align: right;">${nights}</td></tr>
        ${flightRows}
        ${
          promoCode
            ? `<tr><td style="padding: 6px 0; color: #6b645c;">Código promo</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(promoCode)}</td></tr>`
            : ""
        }
        <tr><td style="padding: 6px 0; color: #6b645c;">Interés en tours</td><td style="padding: 6px 0; text-align: right;">${tourInterest ? "Sí" : "No"}</td></tr>
      </table>

      ${
        tourNotes
          ? `<p style="margin: 0 0 16px;"><strong>Notas de tour:</strong> ${escapeHtml(tourNotes)}</p>`
          : ""
      }

      <p style="margin: 20px 0 6px; font-size: 13px; color: #6b645c; text-transform: uppercase; letter-spacing: 0.08em;">Personas declaradas</p>
      <table style="width: 100%; border-collapse: collapse;">
        ${personRow(guest, "titular")}
        ${companions.map((c) => personRow(c, "acompañante")).join("")}
      </table>

      <p style="margin-top: 24px; color: #6b645c; font-size: 13px;">Todo esto ya quedó guardado en Nuku OS — este correo es solo el aviso inmediato.</p>
    </div>
  `.trim();

  return { subject, html };
}

// Contenido del correo de confirmación de reserva. Datos reales confirmados
// por Andre a lo largo del proyecto: no hay cobro online (se paga en el
// hostal, efectivo/débito/crédito nacional o extranjera), desayuno
// continental y traslado aeropuerto incluidos, contacto WhatsApp/email.
export function reservationConfirmationEmail(params: {
  guestName: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  tourInterest: boolean;
}) {
  const { guestName, roomName, checkIn, checkOut, nights, tourInterest } = params;
  const subject = `Tu reserva en Kuhane Etno-Hostal — ${formatDateLong(checkIn)} al ${formatDateLong(checkOut)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2f2b26;">
      <h1 style="font-size: 20px; color: #1f4b43;">¡Hola ${escapeHtml(guestName)}!</h1>
      <p>Tu reserva en <strong>Kuhane Etno-Hostal</strong> quedó registrada. Este es tu resumen:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 6px 0; color: #6b645c;">Habitación</td><td style="padding: 6px 0; text-align: right;"><strong>${escapeHtml(roomName)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Llegada</td><td style="padding: 6px 0; text-align: right;">${formatDateLong(checkIn)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Salida</td><td style="padding: 6px 0; text-align: right;">${formatDateLong(checkOut)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b645c;">Noches</td><td style="padding: 6px 0; text-align: right;">${nights}</td></tr>
      </table>
      <p>El pago se hace directo en el hostal — no se ha realizado ningún cobro online. Aceptamos efectivo, y débito o crédito (nacional o extranjera).</p>
      <p>Tu estadía incluye desayuno continental y traslado desde y hacia el aeropuerto.</p>
      ${
        tourInterest
          ? `<p>Nos avisaste que te interesan tours o experiencias en la isla — nuestro equipo te escribe aparte para coordinar el detalle y el valor.</p>`
          : ""
      }
      <p>Si necesitas coordinar tu llegada o tienes alguna duda, escríbenos por WhatsApp al <strong>+56 9 7766 8288</strong> o a <strong>contacto@kuhanehostal.com</strong>.</p>
      <p style="margin-top: 24px; color: #6b645c; font-size: 13px;">Kuhane Etno-Hostal — Hanga Roa, Isla de Pascua, Rapa Nui.</p>
    </div>
  `.trim();

  return { subject, html };
}
