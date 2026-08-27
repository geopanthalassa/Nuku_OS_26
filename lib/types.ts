// Tipos que reflejan db/schema.sql. Mientras no haya un proyecto Supabase
// conectado, la app se alimenta de /lib/mock-data.ts usando estos mismos
// tipos — así el día que se conecte Supabase, solo cambia de dónde vienen
// los datos, no la forma que tienen.

export type Account = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  status: "trial" | "active" | "paused";
};

export type Room = {
  id: string;
  name: string;
  capacity: number;
  baseRateCents: number | null; // null = [POR CONFIRMAR]
};

export type Guest = {
  id: string;
  fullName: string;
  source: "direct" | "booking" | "instagram" | "airbnb";
  email?: string;
  phone?: string;
};

export type ReservationStatus = "confirmed" | "cancelled" | "completed";

export type Reservation = {
  id: string;
  roomId: string;
  guestId: string;
  checkIn: string; // ISO date
  checkOut: string; // ISO date
  status: ReservationStatus;
  channel: "direct" | "booking" | "airbnb" | "instagram";
  totalCents: number | null;
  paymentStatus: "pending" | "paid" | "refunded";
};

export type ConversationChannel = "whatsapp" | "instagram" | "email";

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sentBy: "system" | "staff" | "guest";
  createdAt: string;
};

export type Conversation = {
  id: string;
  guestId: string;
  channel: ConversationChannel;
  lastMessageAt: string;
  messages: Message[];
};

export type AutomationTemplateKey =
  | "welcome_message"
  | "review_request"
  | "payment_reminder";

export type Automation = {
  id: string;
  templateKey: AutomationTemplateKey;
  label: string;
  description: string;
  enabled: boolean;
};

// Estructura completa que el panel necesita para una cuenta — en producción
// esto se arma con varias consultas a Supabase filtradas por account_id;
// en Fase 0 es un único objeto de ejemplo.
export type AccountWorkspace = {
  account: Account;
  rooms: Room[];
  guests: Guest[];
  reservations: Reservation[];
  conversations: Conversation[];
  automations: Automation[];
};
