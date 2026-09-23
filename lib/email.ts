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

// Paleta real de kuhanehostal.com (kuhane-live/app/globals.css) — se
// reusa acá para que el correo se sienta parte de la misma marca en vez
// de un template genérico.
const BRAND = {
  sand: "#f7f1e4",
  warmWhite: "#fcfaf5",
  stone: "#241f1a",
  stoneSoft: "#4a423a",
  tealDeep: "#0f3638",
  teal: "#1a5f5f",
  gold: "#b99b6b",
  goldSoft: "#ddc9a3",
};

// Foto real del sitio (moai + traslado aeropuerto) — la misma que usa la
// franja de "aeropuerto" en la home de kuhanehostal.com
// (kuhane-live/lib/site-content.ts, aeropuerto.foto). Se referencia por URL
// absoluta porque un correo no puede empaquetar los assets de Next.js.
const HERO_IMAGE_URL = "https://kuhanehostal.com/images/experiencias/aeropuerto.jpg";

// Contenido del correo de confirmación de reserva. Datos reales confirmados
// por Andre a lo largo del proyecto: no hay cobro online (se paga en el
// hostal, efectivo/débito/crédito nacional o extranjera), desayuno
// continental y traslado aeropuerto incluidos, contacto WhatsApp/email.
//
// Rediseño 23/9/2026 a pedido de Andre ("mucho más vistoso y lindo, con
// frases llamativas de la isla") — usa la paleta y la foto real del sitio,
// y dos frases genuinas de la cultura rapanui (no inventadas): "Iorana" es
// el saludo/bienvenida en lengua rapanui, y "Te Pito o Te Henua" ("el
// ombligo del mundo") es el nombre tradicional de la isla — ambas de uso
// público y ya conocido, no traducciones inventadas para este correo.
// Tablas + estilos inline porque así se renderiza de forma confiable en
// Gmail/Outlook/Apple Mail (un <style> en <head> no es fiable en todos).
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
  const firstName = escapeHtml(guestName.trim().split(/\s+/)[0] || guestName);

  const summaryRow = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5ddc9; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.stoneSoft};">${label}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5ddc9; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${BRAND.stone}; text-align: right;">${
        strong ? `<strong>${value}</strong>` : value
      }</td>
    </tr>`;

  const html = `
  <div style="background-color: ${BRAND.sand}; padding: 32px 16px; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: ${BRAND.warmWhite}; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(15, 54, 56, 0.12);">

      <tr>
        <td style="background-color: ${BRAND.tealDeep}; padding: 28px 32px; text-align: center;">
          <p style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 12px; letter-spacing: 4px; text-transform: uppercase; color: ${BRAND.goldSoft};">Kuhane</p>
          <p style="margin: 4px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #d7e6e4;">Etno-Hostal &middot; Rapa Nui</p>
        </td>
      </tr>

      <tr>
        <td>
          <img src="${HERO_IMAGE_URL}" alt="Rapa Nui" width="560" style="display: block; width: 100%; max-width: 560px; height: auto;" />
        </td>
      </tr>

      <tr>
        <td style="padding: 36px 32px 8px;">
          <p style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; color: ${BRAND.tealDeep};">Iorana, ${firstName}!</p>
          <p style="margin: 12px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: ${BRAND.stoneSoft};">
            Tu reserva en <strong style="color: ${BRAND.stone};">Kuhane Etno-Hostal</strong> ya quedó registrada. Tu aventura en Te Pito o Te Henua — el ombligo del mundo — está en cuenta regresiva.
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding: 20px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${summaryRow("Habitación", escapeHtml(roomName), true)}
            ${summaryRow("Llegada", formatDateLong(checkIn))}
            ${summaryRow("Salida", formatDateLong(checkOut))}
            ${summaryRow("Noches", String(nights))}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding: 24px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.7; color: ${BRAND.stoneSoft}; padding: 4px 0;">
                <span style="color: ${BRAND.teal};">&#10003;</span>&nbsp; Desayuno continental incluido
              </td>
            </tr>
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.7; color: ${BRAND.stoneSoft}; padding: 4px 0;">
                <span style="color: ${BRAND.teal};">&#10003;</span>&nbsp; Traslado desde y hacia el aeropuerto incluido
              </td>
            </tr>
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.7; color: ${BRAND.stoneSoft}; padding: 4px 0;">
                <span style="color: ${BRAND.teal};">&#10003;</span>&nbsp; Pago directo en el hostal — sin cobro online (efectivo, débito o crédito nacional o extranjera)
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${
        tourInterest
          ? `<tr>
              <td style="padding: 20px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${BRAND.sand}; border-radius: 10px;">
                  <tr>
                    <td style="padding: 14px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.6; color: ${BRAND.stoneSoft};">
                      Nos avisaste que te interesan tours o experiencias en la isla — nuestro equipo te escribe aparte para coordinar el detalle y el valor.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
          : ""
      }

      <tr>
        <td style="padding: 28px 32px 0;">
          <p style="margin: 0 0 12px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.stoneSoft};">
            ¿Necesitas coordinar tu llegada o tienes alguna duda? Escríbenos:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right: 8px;">
                <a href="https://wa.me/56977668288" style="display: inline-block; background-color: #25D366; color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-decoration: none; padding: 10px 18px; border-radius: 999px;">WhatsApp</a>
              </td>
              <td>
                <a href="mailto:contacto@kuhanehostal.com" style="display: inline-block; background-color: ${BRAND.tealDeep}; color: ${BRAND.warmWhite}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-decoration: none; padding: 10px 18px; border-radius: 999px;">Email</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding: 32px 32px 28px;">
          <p style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 14px; color: ${BRAND.teal};">
            Nos vemos bajo las estrellas de Rapa Nui.
          </p>
        </td>
      </tr>

      <tr>
        <td style="background-color: ${BRAND.sand}; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.5px; color: ${BRAND.stoneSoft};">
            Kuhane Etno-Hostal &middot; Hanga Roa, Isla de Pascua, Rapa Nui
          </p>
        </td>
      </tr>

    </table>
  </div>
  `.trim();

  return { subject, html };
}
