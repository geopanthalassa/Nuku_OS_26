# Fase 1 — Checkpoint D: diseño de disponibilidad y prevención de conflictos

Fecha: 2026-09-02. Esto es diseño — **no se implementó nada todavía.** Como pediste explícitamente para este Checkpoint: alternativas, recomendación, justificación técnica, impacto. Al final me detengo a esperar tu aprobación antes de tocar código o Supabase.

Punto de partida (ya confirmado en Checkpoints A y B): `reservations` tiene un solo CHECK real (`check_out > check_in`, valida una fila contra sí misma) y **ningún mecanismo que compare una reserva contra las demás**. `reservations` tiene 0 filas hoy — cualquier cambio acá parte de cero, sin riesgo de romper datos existentes.

---

## La condición de conflicto (confirmada, ya la diste tú)

Dos reservas de la misma habitación están en conflicto si `nueva.check_in < existente.check_out AND nueva.check_out > existente.check_in`. Con tus ejemplos: 10→15 y 15→20 no chocan (el check-out y el check-in coinciden, se puede rotar la habitación el mismo día); 10→15 y 12→17 sí chocan.

Esto es exactamente lo que en Postgres se modela con un `daterange(check_in, check_out, '[)')` — rango "cerrado al inicio, abierto al final". Dos rangos así definidos se superponen (`&&`) si y solo si cumplen tu misma condición. No es una aproximación: es la representación matemática exacta de la regla que ya definiste.

## Decisión de producto que hay que tomar antes de programar nada

¿Qué estados de `reservations` "ocupan" la habitación para este chequeo? Hoy los valores son `requested | confirmed | cancelled | completed`. Mi lectura:
- `cancelled` — no ocupa, obvio.
- `completed` — la estadía ya pasó, sus fechas quedaron en el pasado; no genera conflictos reales pero no hace daño incluirla.
- `confirmed` — ocupa, sin duda.
- `requested` — acá está la decisión real: una solicitud pública (`/reservar`, sin login) todavía no fue revisada por el equipo. Si `requested` NO ocupa, dos personas podrían pedir las mismas fechas y el equipo se entera recién al revisar ambas a mano (como pasa hoy, sin protección). Si `requested` SÍ ocupa, la primera solicitud "reserva el lugar" en el sistema apenas se manda el formulario, y la segunda persona ve automáticamente que esas fechas ya no están disponibles.

**Mi recomendación: que `requested` también ocupe.** Es la lectura más segura frente al objetivo que planteaste (evitar dobles reservas), y es coherente con cómo ya se comporta `/reservar` — que las fechas de una solicitud sin confirmar puedan chocar con otra solicitud sin confirmar es exactamente el escenario que querés evitar. La única desventaja es que una solicitud nunca confirmada "ocupa" el calendario hasta que el equipo la cancele a mano — aceptable en el volumen de Kuhane, pero avisame si preferís lo contrario.

---

## Alternativas evaluadas

### A. EXCLUSION CONSTRAINT (Postgres, vía extensión `btree_gist`)

```sql
create extension if not exists btree_gist;

alter table reservations
  add constraint reservations_no_overlap
  exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  )
  where (status in ('requested', 'confirmed'));
```

Qué hace: le dice a Postgres "para la misma `room_id`, ningún par de filas puede tener rangos de fecha que se crucen" — y Postgres lo garantiza él mismo, a nivel de motor, para *cualquier* inserción o actualización, sin importar desde qué código venga (la app, un script, el SQL editor de Supabase, una futura integración). Es el mismo mecanismo que un `UNIQUE`, pero para rangos en vez de valores exactos — y por eso hereda la misma propiedad clave: es **atómico y a prueba de condiciones de carrera**. Si dos personas mandan la solicitud en el mismo milisegundo para las mismas fechas, Postgres serializa las dos transacciones y la segunda falla con un error claro, sin importar qué tan rápido llegaron.

Ventajas: es la única de las alternativas que resuelve el Paso 6 completo (protección "lo más cerca posible de la fuente de verdad") sin depender de que la aplicación se acuerde de chequear correctamente en cada lugar donde se cree una reserva. Además crea automáticamente el índice GiST que hace falta para responder rápido "¿está disponible esta habitación estas fechas?" — resolviendo de paso el hueco de índices que quedó anotado en Checkpoint B.

Costo: instalar una extensión (`btree_gist`, estándar de Postgres, no es código de terceros) y una migración que agrega la constraint. Con 0 filas en `reservations` hoy, el `ALTER TABLE` es instantáneo y no puede fallar por datos existentes.

### B. Chequeo en la aplicación antes de insertar (SELECT de conflictos)

Antes de crear la reserva, consultar si existe alguna fila de esa `room_id` con status ocupante cuyo rango se cruce, y rechazar si la hay. Es necesario igual — da el mensaje de error amigable ("esas fechas ya no están disponibles") en vez de que el huésped vea un error crudo de Postgres — pero **sola, no alcanza**: dos solicitudes simultáneas pueden pasar ambas el chequeo antes de que cualquiera termine de insertar (exactamente el caso de prueba #9 que pediste: "dos intentos simultáneos no deben producir una doble reserva incompatible"). Por eso no es una alternativa a A, es un complemento.

### C. Transacción con locking explícito (`SELECT ... FOR UPDATE` o lock por `room_id`)

Envolver el chequeo + inserción en una transacción que bloquea la habitación mientras dura la operación (lock explícito o `SERIALIZABLE`). Funciona, pero hay que aplicarlo correctamente en **cada** lugar del código que inserte en `reservations` (hoy: `/api/reservations/request`; a futuro: cualquier "crear reserva manual" del panel, cualquier integración con Booking/Airbnb) — si alguien agrega un tercer camino de escritura y se olvida del lock, la protección desaparece silenciosamente ahí. Con `SERIALIZABLE` además hay que manejar reintentos ante fallos de serialización, que es una complejidad extra que la opción A no necesita.

### D. Función RPC (`create_reservation(...)` en Postgres)

Una función de Postgres que hace el chequeo + inserción como una sola operación atómica, y devuelve un error legible si hay conflicto. Es una buena idea, pero **no como reemplazo de A, sino como interfaz sobre A**: adentro de esa función, lo que realmente evita la condición de carrera sigue siendo la exclusion constraint (o un lock explícito) — la función por sí sola, sin eso debajo, tiene el mismo problema de B.

---

## Recomendación

**A (exclusion constraint) como garantía real, más una capa de aplicación reutilizable por encima que la usa para chequear disponibilidad y dar buenos mensajes de error.** No uso C (locking manual) porque A ya resuelve el problema de concurrencia de forma declarativa, con menos código propio para mantener y sin que dependa de que cada desarrollador futuro se acuerde de aplicarlo.

Justificación técnica: es el mecanismo estándar de Postgres para exactamente este problema (se documenta en el propio manual de Postgres como el caso de uso típico de `EXCLUDE ... USING gist`), no es una solución improvisada. Con 0 reservas reales hoy, aplicarla no tiene downside — es el mejor momento posible para agregarla, antes de que exista cualquier dato que pudiera (en teoría) violarla.

### La capa reutilizable (Paso 7 — diseño, no implementación todavía)

Un único módulo, ej. `lib/availability.ts`, con una función:

```ts
checkAvailability({ accountId, roomId, checkIn, checkOut, excludeReservationId? }):
  Promise<{ available: true } | { available: false; conflictingReservationId: string }>
```

Usada por: `/api/reservations/request` (antes de insertar, para el mensaje amigable), y más adelante por Calendario (para pintar qué días están libres), el Concierge IA (para no inventar disponibilidad — puede consultar esta función como "tool" real en vez de responder de memoria), y cualquier "crear reserva manual" que se agregue al panel. `excludeReservationId` es para cuando el panel edite las fechas de una reserva ya existente (no debe chocar consigo misma). La exclusion constraint de la base sigue siendo quien realmente lo garantiza pase lo que pase — esta función es la que da la experiencia agradable antes de llegar a ese punto.

No estoy implementando esto todavía — es el diseño que pediste para este Checkpoint.

## Impacto en reservas existentes

Ninguno: `reservations` tiene 0 filas. Si en el futuro llegara a tener datos que violen la regla (no debería pasar nunca, porque la propia constraint lo impediría desde el momento en que se instale), el `ALTER TABLE ... ADD CONSTRAINT` fallaría con un mensaje claro señalando qué filas chocan, en vez de aplicarse a medias — Postgres no permite dejar una constraint "parcialmente aplicada".

---

**DETENGO ACÁ**, tal como pediste para este Checkpoint. No instalé `btree_gist`, no agregué la constraint, no toqué `/api/reservations/request` ni creé `lib/availability.ts` — todo lo de arriba es la propuesta. Quedo esperando tu aprobación (y tu decisión sobre si `requested` debe ocupar el calendario o no) antes de pasar al **Checkpoint E** (implementación).
