# Piloto: Kuhane real + Refugio Alerce (hotel inventado para probar)

Fecha: 2026-09-02. Esto es lo que hice para que puedas entrar de verdad al panel y probar Nuku OS "como si todo funcionara y todo estuviese conectado" — porque ahora, en los dos casos, todo está conectado de verdad (Supabase Auth real, RLS real, la misma base de producción).

---

## 1. Kuhane — ya podés entrar de verdad

Hasta hoy `account_members` tenía 0 filas y nadie podía entrar al panel (lo confirmamos en Checkpoint B). Creé el usuario real de Supabase Auth que faltaba y lo vinculé a Kuhane como `owner`:

- **URL de login:** `/login` (el mismo panel de siempre)
- **Email:** `geopanthalassa@gmail.com`
- **Contraseña temporal:** `FMHAdROQg5psio`

Es tu cuenta real de Kuhane — todo lo que veas ahí (reservas, huéspedes, bandeja) es producción real. No toqué ningún dato de Kuhane: `guests` y `reservations` siguen en 0 filas, exactamente como estaban. Te recomiendo cambiar esa contraseña una vez que entres (no hay todavía un botón de "cambiar contraseña" en el panel — se puede hacer desde el propio Supabase Dashboard, Authentication → Users, o pedime que le agregue esa opción al panel).

## 2. Refugio Alerce — el hotel inventado, con datos de prueba

Para tener algo con lo que probar sin ensuciar los datos reales de Kuhane, inventé una segunda cuenta completa: un refugio de montaña ficticio en Pucón (para que se note claramente que es un cliente distinto — otra región, otro tipo de alojamiento). Quedó marcado como cuenta demo tanto en el nombre como en `concierge_settings.business_facts.cuenta_demo = true`, para que no se confunda con un cliente real más adelante.

- **URL de login:** `/login` (mismo panel, es 100% multi-cliente)
- **Email:** `geopanthalassa+refugioalerce@gmail.com` (con el `+`, te llega igual a tu Gmail si alguna vez mandara un correo — hoy no manda ninguno)
- **Contraseña temporal:** `tjPkK9gBhA7Nn8`

### Qué le cargué

- **Propiedad:** Refugio Alerce, Camino Internacional km 2, Pucón, Región de la Araucanía.
- **4 habitaciones** con tarifa real cargada: Cabaña Volcán Villarrica ($285.000/noche, cap. 4), Habitación Lago Todos los Santos ($198.000, cap. 2), Suite Araucaria ($242.000, cap. 2), Dormitorio Compartido Cóndor ($95.000, cap. 6).
- **5 huéspedes ficticios** (emails `@example.com`, no existen de verdad, no les llega nada a nadie).
- **7 reservas**, a propósito con los 4 estados distintos y sin pisarse entre sí en la misma habitación (la exclusion constraint de Checkpoint E las habría rechazado si se pisaran):
  | Huésped | Habitación | Fechas | Estado |
  |---|---|---|---|
  | Valentina Rojas | Cabaña Volcán | 10→15 jul 2026 | completed |
  | Martín Bravo | Hab. Lago | 20→25 ago 2026 | completed |
  | Camila Fernández | Hab. Lago | 10→14 sep 2026 | confirmed (con promo `BIENVENIDA10` e interés en tours) |
  | Diego Salinas | Suite Araucaria | 5→8 sep 2026 | confirmed (con datos de vuelo de llegada) |
  | Valentina Rojas | Dormitorio Cóndor | 1→4 sep 2026 | confirmed — **huésped alojado ahora mismo** (hoy es 2 sep) |
  | Isidora Pizarro | Suite Araucaria | 20→23 sep 2026 | requested — pendiente de revisión, ya ocupa el calendario |
  | Martín Bravo | Dormitorio Cóndor | 15→18 jun 2026 | cancelled |
- **3 automatizaciones** activas (mismas plantillas que usa Kuhane: bienvenida_reserva, recordatorio_pago, solicitud_reseña).
- **Concierge IA** con datos básicos del refugio (horarios, wifi, mascotas) para que puedas probar la bandeja/concierge sin que responda genérico.

## 3. Qué podés probar ya mismo

- **Entrar con ambos logins** (podés tenerlos abiertos en dos pestañas, o una normal y otra de incógnito) y confirmar que cada uno ve *solo* su propia cuenta — Reservas, Calendario, Desayunos, Bandeja y Automatizaciones ya resuelven la cuenta por sesión (Checkpoint C), no por un valor fijo en el código.
- **Calendario de Refugio Alerce:** vas a ver la reserva `requested` de Isidora ya ocupando esas fechas — es la decisión que tomamos en Checkpoint D/E (una solicitud sin confirmar bloquea el calendario para que no se dupliquen).
- **Ficha de desayunos:** las 7 reservas ya tienen su huésped titular cargado en `reservation_guests`, así que el módulo de Desayunos de Refugio Alerce no debería aparecer vacío.

### Lo único que quedó afuera (no lo toqué, es una decisión aparte)

El formulario público `/reservar` (el que ve un huésped sin login) todavía apunta siempre a Kuhane — es un hardcode que ya existía desde antes de Fase 1 (`lib/current-account.ts`, marcado ahí mismo como "temporal"). No lo cambié porque es una decisión de producto (¿cómo elige un visitante público a qué hotel le está reservando — por subdominio, por slug en la URL?) que no me pediste todavía. Si querés probar también el flujo público con Refugio Alerce, decime cómo preferís resolverlo y lo armo.

## 4. Verificación

- `accounts`: 2 filas (Kuhane + Refugio Alerce). `auth.users`: 2 filas. `account_members`: 2 filas.
- Kuhane sigue con `guests` y `reservations` en 0 filas — no se tocó ningún dato real.
- Corrí `get_advisors` (seguridad) después de todo esto: sin alertas nuevas — la única que aparece (protección contra contraseñas filtradas, desactivada) es una configuración general del proyecto, no algo que haya introducido yo.
