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

  // Rediseño 23/9/2026: Andre notó que este correo (interno, al equipo)
  // no llevaba el logo de Kuhane, a diferencia del de confirmación al
  // huésped — "como dijimos que debía ser". Se le agrega la misma franja
  // de header con el logo real (LOGO_URL/BRAND, definidos más abajo en
  // este archivo — están disponibles porque esta función solo se ejecuta
  // después de que el módulo entero ya cargó), sin la foto/bienvenida
  // "IORANA" del correo de huésped, que no aplica para un aviso interno.
  const html = `
  <div style="background-color: ${BRAND.sand}; padding: 24px 16px; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: ${BRAND.warmWhite}; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(15, 54, 56, 0.12);">

      <!-- Header: logo real de Kuhane, igual que en el correo de confirmación al huésped -->
      <tr>
        <td style="background-color: ${BRAND.tealDeep}; padding: 24px 32px 20px; text-align: center;">
          <img src="${LOGO_URL}" alt="Kuhane Etno-Hostal" width="160" height="108" style="display: block; width: 160px; max-width: 55%; height: auto; margin: 0 auto;" />
        </td>
      </tr>

      <tr>
        <td style="padding: 28px 32px 8px;">
          <h1 style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 20px; color: ${BRAND.tealDeep};">Nueva solicitud de reserva</h1>
          <p style="margin: 6px 0 0; color: ${BRAND.stoneSoft}; font-size: 13px;">ID reserva: ${escapeHtml(reservationId)}</p>
        </td>
      </tr>

      <tr>
        <td style="padding: 12px 32px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Habitación</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};"><strong>${escapeHtml(roomName)}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Llegada</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};">${formatDateLong(checkIn)}</td></tr>
            <tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Salida</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};">${formatDateLong(checkOut)}</td></tr>
            <tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Noches</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};">${nights}</td></tr>
            ${flightRows}
            ${
              promoCode
                ? `<tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Código promo</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};">${escapeHtml(promoCode)}</td></tr>`
                : ""
            }
            <tr><td style="padding: 6px 0; color: ${BRAND.stoneSoft}; font-size: 14px;">Interés en tours</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: ${BRAND.stone};">${tourInterest ? "Sí" : "No"}</td></tr>
          </table>

          ${
            tourNotes
              ? `<p style="margin: 12px 0 0; font-size: 14px; color: ${BRAND.stone};"><strong>Notas de tour:</strong> ${escapeHtml(tourNotes)}</p>`
              : ""
          }
        </td>
      </tr>

      <tr>
        <td style="padding: 20px 32px 4px;">
          <p style="margin: 0 0 6px; font-size: 12px; color: ${BRAND.teal}; text-transform: uppercase; letter-spacing: 0.08em;">Personas declaradas</p>
          <table style="width: 100%; border-collapse: collapse;">
            ${personRow(guest, "titular")}
            ${companions.map((c) => personRow(c, "acompañante")).join("")}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding: 16px 32px 28px;">
          <p style="margin: 0; color: ${BRAND.stoneSoft}; font-size: 12px;">Todo esto ya quedó guardado en Nuku OS — este correo es solo el aviso inmediato.</p>
        </td>
      </tr>

    </table>
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

// Foto real del sitio (moai en la puesta de sol) — la misma que usa la
// sección "El atardecer" en kuhanehostal.com (site-content.ts,
// experiencias.items). Encaja con "Soul of Sunset", la bajada real del
// logo de Kuhane. Se referencia por URL absoluta porque un correo no
// puede empaquetar los assets de Next.js.
const HERO_IMAGE_URL = "https://kuhanehostal.com/images/experiencias/atardecer.jpg";

// Logo real de Kuhane (kuhane-live/public/logo/kuhane-lockup-full.png) —
// el mismo que usa el Footer del sitio. Reemplaza el texto "KUHANE" en
// tipografía genérica que llevaba la primera versión de este correo:
// Andre pidió (23/9/2026) que fuera el logo real, no texto.
const LOGO_URL = "https://kuhanehostal.com/logo/kuhane-lockup-full.png";

// Datos reales de la ficha/comprobante oficial de Kuhane (el PDF de
// confirmación que Andre ya usa y que compartió como referencia de
// diseño, 23/9/2026): mismo domicilio que site.address en site-content.ts,
// mismo número de registro Sernatur impreso en ese PDF.
const SERNATUR_NUMBER = "2789";
const ADDRESS = "Kahu Mahau s/n, Hanga Roa, Isla de Pascua";

type GuestForEmail = { fullName: string; nationality?: string | null; documentId?: string | null };

// Contenido del correo de confirmación de reserva. Datos reales confirmados
// por Andre a lo largo del proyecto: no hay cobro online (se paga en el
// hostal, efectivo/débito/crédito nacional o extranjera), desayuno
// continental y traslado aeropuerto incluidos, contacto WhatsApp/email.
//
// Rediseño 23/9/2026 (segunda vuelta) a pedido de Andre: mandó como
// referencia el PDF de confirmación que Kuhane ya usa (mismo logo, franja
// color arena, "IORANA! Tenemos el agrado de CONFIRMAR SU RESERVA", lista
// de huéspedes con nacionalidad, footer con contacto) y pidió calcar ese
// estilo pero con nuestra paleta ya establecida y otra foto. "Iorana" (el
// saludo en lengua rapanui) y "Te Pito o Te Henua" ("el ombligo del
// mundo", nombre tradicional de la isla) son frases reales de uso
// público, no inventadas para este correo.
// Tablas + estilos inline porque así se renderiza de forma confiable en
// Gmail/Outlook/Apple Mail (un <style> en <head> no es fiable en todos).
export function reservationConfirmationEmail(params: {
  guestName: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  tourInterest: boolean;
  guests?: GuestForEmail[];
}) {
  const { guestName, roomName, checkIn, checkOut, nights, tourInterest, guests } = params;
  const subject = `Tu reserva en Kuhane Etno-Hostal — ${formatDateLong(checkIn)} al ${formatDateLong(checkOut)}`;
  const firstName = escapeHtml(guestName.trim().split(/\s+/)[0] || guestName);

  // Fila de la lista de huéspedes — mismo formato que el PDF de referencia
  // (nombre a la izquierda, nacionalidad a la derecha, documento debajo).
  const guestRow = (g: GuestForEmail) => `
    <tr>
      <td style="padding: 9px 0; border-bottom: 1px solid #e5ddc9;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${BRAND.tealDeep}; font-weight: bold;">${escapeHtml(
              g.fullName
            )}</td>
            <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.teal}; text-align: right;">${
              g.nationality ? escapeHtml(g.nationality) : ""
            }</td>
          </tr>
          ${
            g.documentId
              ? `<tr><td colspan="2" style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${BRAND.stoneSoft}; padding-top: 2px;">Doc: ${escapeHtml(
                  g.documentId
                )}</td></tr>`
              : ""
          }
        </table>
      </td>
    </tr>`;

  const guestListHtml =
    guests && guests.length > 0
      ? guests.map(guestRow).join("")
      : guestRow({ fullName: guestName });

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

      <!-- Header: logo real de Kuhane sobre fondo verde + badge Sernatur -->
      <tr>
        <td style="background-color: ${BRAND.tealDeep}; padding: 32px 32px 26px; text-align: center;">
          <img src="${LOGO_URL}" alt="Kuhane Etno-Hostal — Soul of Sunset" width="220" height="149" style="display: block; width: 220px; max-width: 70%; height: auto; margin: 0 auto;" />
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 16px auto 0;">
            <tr>
              <td style="background-color: rgba(252,250,245,0.12); border: 1px solid ${BRAND.goldSoft}; border-radius: 999px; padding: 5px 16px;">
                <span style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 1.5px; color: ${BRAND.goldSoft};">SERNATUR N&deg;${SERNATUR_NUMBER}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Foto real: atardecer con moai (encaja con "Soul of Sunset") -->
      <tr>
        <td>
          <img src="${HERO_IMAGE_URL}" alt="Atardecer en Rapa Nui" width="560" height="747" style="display: block; width: 100%; max-width: 560px; height: auto;" />
        </td>
      </tr>

      <!-- Franja color arena: "IORANA! confirmamos tu reserva" -->
      <tr>
        <td style="background-color: ${BRAND.goldSoft}; padding: 28px 32px;">
          <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 18px; color: ${BRAND.tealDeep};">
            <strong>&iexcl;IORANA, ${firstName}!</strong> Tenemos el agrado de<br />confirmar tu reserva
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 16px 0;">
            <tr>
              <td style="background-color: ${BRAND.warmWhite}; border-radius: 8px; padding: 10px 18px;">
                <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.stoneSoft};">desde el</span>
                <strong style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.tealDeep};"> ${formatDateLong(
                  checkIn
                ).toUpperCase()} </strong>
                <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.stoneSoft};">hasta el</span>
                <strong style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${BRAND.tealDeep};"> ${formatDateLong(
                  checkOut
                ).toUpperCase()}</strong>
              </td>
            </tr>
          </table>
          <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: ${BRAND.stoneSoft};">
            Estamos muy encantados de recibirte y asegurarte una <strong style="color: ${BRAND.tealDeep};">experiencia memorable</strong>, en Te Pito o Te Henua — el ombligo del mundo.
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 18px;">
            ${guestListHtml}
          </table>
        </td>
      </tr>

      <!-- Resumen de la reserva -->
      <tr>
        <td style="padding: 28px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${summaryRow("Habitación", escapeHtml(roomName), true)}
            ${summaryRow("Noches", String(nights))}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding: 20px 32px 0;">
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
            &iquest;Necesitas coordinar tu llegada o tienes alguna duda? Escr&iacute;benos:
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

      <!-- Footer con contacto, igual al comprobante oficial -->
      <tr>
        <td style="background-color: ${BRAND.tealDeep}; padding: 20px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${BRAND.goldSoft}; padding: 3px 0;">&#128205;&nbsp; ${ADDRESS}</td>
            </tr>
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${BRAND.goldSoft}; padding: 3px 0;">&#127760;&nbsp; www.kuhanehostal.com</td>
            </tr>
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${BRAND.goldSoft}; padding: 3px 0;">&#9993;&nbsp; contacto@kuhanehostal.com</td>
            </tr>
            <tr>
              <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${BRAND.goldSoft}; padding: 3px 0;">&#128222;&nbsp; +56 9 7766 8288</td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </div>
  `.trim();

  return { subject, html };
}
