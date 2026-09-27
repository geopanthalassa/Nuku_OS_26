import type { AccountWorkspace } from "./types";

// Cuenta de ejemplo para la Fase 0 — ahora es Kuhane Etno-Hostal, no un
// hostal ficticio. Se actualizó a pedido de Andre para que la demo se
// sienta como Kuhane en vez de un nombre genérico.
//
// Importante: solo el NOMBRE de la cuenta es un dato real y verificado
// (viene de kuhane-web/lib/site-content.ts). Las habitaciones, huéspedes
// y reservas siguen siendo de ejemplo — Kuhane todavía no tiene precios,
// nombres de habitación ni un sistema de reservas real (en el sitio
// público esos mismos campos siguen como [POR CONFIRMAR]). Se mantiene la
// misma regla del proyecto: no inventar datos. Cuando lleguen los datos
// reales de habitaciones y huéspedes (Fase 5 del plan), este archivo deja
// de usarse y la app pasa a leer desde Supabase.

const NOT_CONFIRMED = null; // igual al TODO_PLACEHOLDER de kuhane-web, pero tipado

export const demoWorkspace: AccountWorkspace = {
  account: {
    id: "kuhane",
    name: "Kuhane Etno-Hostal",
    slug: "kuhane",
    currency: "CLP",
    status: "trial",
  },
  rooms: [
    // Nombres y tarifas [POR CONFIRMAR] — igual que en habitaciones[] de
    // kuhane-web. No se inventan nombres tipo "Suite Jardín": se etiquetan
    // por número hasta tener la ficha real de cada habitación.
    { id: "room-1", name: "Habitación 1 [POR CONFIRMAR]", capacity: 2, baseRateCents: NOT_CONFIRMED },
    { id: "room-2", name: "Habitación 2 [POR CONFIRMAR]", capacity: 2, baseRateCents: NOT_CONFIRMED },
  ],
  guests: [
    { id: "guest-1", fullName: "Familia Rossi (huésped de ejemplo)", source: "instagram" },
    { id: "guest-2", fullName: "J. Takahashi (huésped de ejemplo)", source: "booking" },
    { id: "guest-3", fullName: "M. Pérez (huésped de ejemplo)", source: "direct" },
  ],
  reservations: [
    {
      id: "res-1",
      roomId: "room-1",
      guestId: "guest-1",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      status: "confirmed",
      channel: "instagram",
      totalCents: NOT_CONFIRMED,
      paymentStatus: "paid",
    },
    {
      id: "res-2",
      roomId: "room-2",
      guestId: "guest-2",
      checkIn: "2026-09-14",
      checkOut: "2026-09-19",
      status: "confirmed",
      channel: "booking",
      totalCents: NOT_CONFIRMED,
      paymentStatus: "pending",
    },
    {
      id: "res-3",
      roomId: "room-1",
      guestId: "guest-3",
      checkIn: "2026-09-05",
      checkOut: "2026-09-07",
      status: "completed",
      channel: "direct",
      totalCents: NOT_CONFIRMED,
      paymentStatus: "paid",
    },
  ],
  conversations: [
    {
      id: "conv-1",
      guestId: "guest-1",
      channel: "whatsapp",
      lastMessageAt: "2026-08-26T14:03:00Z",
      messages: [
        {
          id: "msg-1",
          direction: "inbound",
          body: "Hola! ¿Hacen traslado desde el aeropuerto?",
          sentBy: "guest",
          createdAt: "2026-08-26T14:02:00Z",
        },
        {
          id: "msg-2",
          direction: "outbound",
          body: "¡Hola! Sí, el traslado está incluido — alguien del equipo te espera en Mataveri.",
          sentBy: "staff",
          createdAt: "2026-08-26T14:03:00Z",
        },
      ],
    },
    {
      id: "conv-2",
      guestId: "guest-2",
      channel: "instagram",
      lastMessageAt: "2026-08-26T11:15:00Z",
      messages: [
        {
          id: "msg-3",
          direction: "inbound",
          body: "¿Tienen disponibilidad para marzo?",
          sentBy: "guest",
          createdAt: "2026-08-26T11:15:00Z",
        },
      ],
    },
  ],
  automations: [
    {
      id: "auto-1",
      templateKey: "welcome_message",
      label: "Bienvenida al confirmar reserva",
      description: "Envía datos de llegada y check-in apenas se confirma una reserva.",
      enabled: true,
    },
    {
      id: "auto-2",
      templateKey: "review_request",
      label: "Solicitud de reseña",
      description: "Pide una reseña 24 horas después del check-out.",
      enabled: true,
    },
    {
      id: "auto-3",
      templateKey: "payment_reminder",
      label: "Recordatorio de pago pendiente",
      description: "Avisa al huésped si el saldo sigue pendiente 48 horas antes de la llegada.",
      enabled: false,
    },
  ],
};
