export function formatMoney(cents: number | null, currency = "CLP") {
  if (cents === null) return "[POR CONFIRMAR]";
  const amount = cents / 100;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateRange(checkIn: string, checkOut: string) {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const inD = new Date(checkIn + "T00:00:00");
  const outD = new Date(checkOut + "T00:00:00");
  const fmt = new Intl.DateTimeFormat("es-CL", opts);
  return `${fmt.format(inD)} — ${fmt.format(outD)}`;
}

export function nights(checkIn: string, checkOut: string) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
