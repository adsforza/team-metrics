export interface MemberOption { id: string; name: string }

// Normaliza para que "rodriguez" encuentre "Rodríguez": con 40 nombres, exigir
// los acentos hace que el buscador parezca roto.
function norm(s: string): string {
  // El rango va escrito como escapes (\u0300-\u036f) a proposito: son marcas
  // combinantes invisibles, y pegarlas literales en el fuente las corrompe.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterMembers(members: MemberOption[], query: string): MemberOption[] {
  const q = norm(query.trim());
  if (!q) return members;
  return members.filter(m => norm(m.name).includes(q));
}

export function personFilterLabel(selected: string[], members: MemberOption[]): string {
  if (selected.length === 0) return 'Todos';
  if (selected.length === 1) {
    return members.find(m => m.id === selected[0])?.name ?? '1 persona';
  }
  return `${selected.length} personas`;
}
