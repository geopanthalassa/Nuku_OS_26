# Plantillas de n8n

Estos `.json` son plantillas para importar en n8n (menú **⋮ → Import from File**
en un workflow nuevo). Son un punto de partida realista, no un producto
terminado: n8n cambia parámetros de nodo entre versiones, así que si algo
no importa perfecto, el `notes` de cada nodo explica qué tiene que hacer ese
paso — se puede recrear a mano en un minuto.

## Qué hay acá

- **`concierge-inbound.json`** — recibe un mensaje de huésped (de cualquier
  canal), llama a `/api/concierge/inbound` de Nuku OS para que la IA genere
  la respuesta, y la manda de vuelta.
- **`automation-reserva-confirmada.json`** — dispara cuando se confirma una
  reserva, llama a `/api/automations/render` para armar el mensaje de
  bienvenida (respetando si esa cuenta la tiene apagada), y lo envía.
  El mismo patrón sirve para las otras dos automatizaciones del panel
  (`solicitud_resena`, `recordatorio_pago`) — se duplica este workflow,
  se cambia `template_key` y el disparador (24h después del check-out /
  48h antes de la llegada con `payment_status = pending`).

## Cómo se onboardea un cliente nuevo con esto

1. Duplicar cada plantilla dentro de n8n (una copia por cliente, no un
   workflow compartido — así cada cliente puede tener sus propias
   credenciales de canal sin pisar las de otro).
2. En el nodo **"Config de esta cuenta"** de cada copia, pegar el
   `account_id` real de ese cliente (el `id` de su fila en la tabla
   `accounts` de Supabase).
3. En el/los nodo(s) de envío (marcados como "Enviar por el canal"),
   conectar la credencial real de ese cliente: WhatsApp Business API,
   Instagram Graph API, SMTP, etc. — lo único que varía por canal.
4. Activar el workflow.

Nada de esto toca el código de Nuku OS. El código es el mismo para todos los
clientes; lo que cambia por cliente vive en Supabase (la fila de `accounts`
y `concierge_settings`) y en estos workflows de n8n (el `account_id` y las
credenciales de canal).

## Variable de entorno que necesitan estos workflows

En n8n, configurar una variable de entorno `NUKU_OS_BASE_URL` (Settings →
Environment Variables si es n8n self-hosted, o Variables en n8n Cloud) con
la URL pública del deployment de Nuku OS, ej. `https://nuku-os-app.vercel.app`.
