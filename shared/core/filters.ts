// Extraido de scorecard.ts, donde ya se usaba para el agregado restringido del
// equipo. OJO con la convencion: `undefined` = sin filtro, `[]` = no matchea nada.
// El store del mobile usa la convencion OPUESTA ([] = todos), asi que quien arma
// los filtros debe convertir: selected.length > 0 ? selected : undefined.
export function matchesAssignees(assigneeId: string | null, assignees?: string[]): boolean {
  if (assignees === undefined) return true;
  if (assignees.length === 0) return false;
  return assigneeId != null && assignees.includes(assigneeId);
}
