# Filtro de personas — pendientes conocidos

Salen del triage de la revisión final de `feat/filtro-personas` (2026-09-21).
Ninguno bloquea el merge; se dejan escritos para no perderlos.

## Decisiones de producto sin resolver

**La banda de contexto del scorecard se calcula sobre el subconjunto visible.**
`shared/core/scorecard.ts` arma el `min/median/max` con el que se posiciona a cada
persona usando solo a los elegidos. Con dos personas seleccionadas, la banda son esas
dos y el posicionamiento relativo pierde referencia: cada una queda siempre en un
extremo. La alternativa es calcularla sobre el equipo completo aunque la tabla muestre
un subconjunto — la banda como marco de referencia fijo.

**La solapa Carga ignora el filtro de personas, por diseño.**
`computeWorkload` recibe solo `from`/`to`: se organiza por squad y equipo solicitante,
no por assignee. Es coherente con el server, pero el chip de la barra superior dice
"N personas" en una pantalla donde ese filtro no aplica. O se aclara en la UI, o la
barra oculta el selector en esa solapa.

## Deuda técnica menor

**`mobile/hooks/useIssues.ts` lee `readTeamMemberNames`**, que consulta
`scorecard_members` — la tabla que `recomputeSnapshots` reescribe ya filtrada. No es el
círculo vicioso que se arregló en el selector (acá solo se arma un mapa id→nombre), pero
hereda el filtro `hasAllData`: alguien sin datos suficientes aparece con su id crudo en
vez de su nombre. Preexistente.

**El `catch` de `recompute` reemplaza `errors[]` en vez de concatenar**
(`mobile/store/syncStore.ts`), así que pisa errores de un `sync()` previo.

**Un `recompute` exitoso no limpia un `lastSyncStatus: 'partial'` anterior.** La cabecera
queda en "parcial" hasta el próximo `sync()`.

**El error del sync con varias personas solo se ve como alerta desde Ajustes.** Desde el
botón del `SyncHeader` el único canal es "sync parcial · …", que no dice por qué. Para que
sea inequívoco habría que renderizar `errors[]` en un lugar común.

**`mobile/__tests__/coreLoad.test.ts`** verifica el fuente con `toContain`, así que pasaría
solo con un comentario. La aserción que realmente protege es el `not.toMatch`.

**`shared/core/types.ts`**: `CoreFilter` y `FilterParams` quedaron idénticos byte a byte;
uno debería ser alias del otro.

**`/api/team` no lee `?assignee`** aunque `computeScorecard` ya lo soporta. El `CLAUDE.md`
afirma que *todos* los endpoints aceptan ese parámetro, así que o se cablea en una línea o
se corrige el doc. Preexistente y sin impacto: el cliente web no llama a ese endpoint.

## Cuidado al editar

**`mobile/lib/personFilter.ts`** tiene escapes Unicode (`̀-ͯ`) que se corrompen
al escribirlos con las herramientas de edición normales: quedan como bytes de marcas
combinantes en vez de texto literal. Si hay que tocar ese `norm()`, generá el archivo con
un script y verificá los bytes con `od -c` o `xxd`.
