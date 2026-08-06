# Runbook — prueba en device del sync incremental (SP-A..SP-D)

Server en `main`, verificado en vivo: `http://192.168.0.182:3001/api/raw` y `/api/tallas` → 200.

## 0. Preparar
- Mac y iPhone en la **misma WiFi**.
- Server dev corriendo (`cd server && npm run dev`). Ya está levantado con el código nuevo.
- Rebuild en **Xcode (Release)**: no se agregaron módulos nativos nuevos en esta iniciativa, así que si ya hiciste `pod install` antes (por expo-secure-store), alcanza con rebuild. Si no: `cd mobile/ios && pod install` primero.

## 1. Backend mode (en casa)
1. App → **Ajustes → Servidor → URL base** = `http://192.168.0.182:3001`.
2. **Sincronizar**. Verificá:
   - Aparecen los **pasos de progreso** (header/Ajustes): "Bajando métricas…" → "Enviando tallas…" → "Bajando novedades…" (no solo la ruedita).
   - Header muestra sync OK (sin "· directo").
   - Los datos se actualizan.

## 2. Push de tallas (celu → server)
Solo aplica si el celu tiene tallas clasificadas localmente (de un direct sync previo).
1. Tras un backend sync, esas tallas se envían al server (`POST /api/tallas`, fill-only).
2. Verificación server: `curl -s http://localhost:3001/api/sync/status` → mirá que `unclassified` baje / o revisá que el server no re-clasifique lo que el celu ya mandó.

## 3. Reclasificar
- **Ajustes → Reclasificar tallas**:
  - Con server disponible → dispara el reclassify del server (alert "Reclasificación iniciada").
  - Sin server → clasifica local con Gemini (limitado por cuota).

## 4. Direct mode (fuera de casa) — el delta
1. Cargá **Ajustes → "Jira directo"** (baseUrl, email `dev@example.com`, apiToken con el 👁 para verificar 192 chars, projectKey, boardIds `7,9`, geminiKey). **Probar conexión** → "Jira OK ✅".
2. Apagá el server (o modo avión / otra red).
3. **Sincronizar**: como venías de backend mode (que dejó el crudo caliente), el primer direct **no** re-baja todo Jira — solo el delta. Header muestra "· directo".

## Qué observar (criterios de éxito)
- [ ] Progreso visible en cada sync.
- [ ] Backend mode trae datos + no re-clasifica lo ya clasificado.
- [ ] Switch backend→direct: fetch acotado (delta), no full.
- [ ] Sin falsos "Sync parcial" cuando el sync sale OK.

Si algo falla, el alert de "Sync parcial" (solo en fallo real) y el botón "Probar conexión" dan el detalle. Pasámelo y lo depuramos.
