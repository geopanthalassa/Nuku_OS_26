// 27/9/2026: pedido de Andre — distinguir las habitaciones por color, no
// solo por nombre, para una lectura más rápida en Reservas, Calendario y
// Disponibilidad. Cada habitación tiene su color guardado en rooms.color
// (ver db/schema.sql); este punto lo pinta donde sea que aparezca el
// nombre. Si una habitación todavía no tiene color asignado, se ve un
// punto gris neutro en vez de romper el layout.
export default function RoomDot({ color, className = "" }: { color?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 ${className}`}
      style={{ backgroundColor: color ?? "#c7c2b3" }}
    />
  );
}
