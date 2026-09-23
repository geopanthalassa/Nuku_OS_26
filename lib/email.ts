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
