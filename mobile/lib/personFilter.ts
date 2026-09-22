export interface MemberOption {
  id: string;
  name: string;
  /** Issues asignados. Define el orden del selector; opcional para los tests. */
  issueCount?: number;
}

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

export interface VisibleMembers {
  shown: MemberOption[];
  /** Cuantos quedaron fuera por el limite. 0 cuando no se trunco. */
  hidden: number;
  truncated: boolean;
}

/**
 * Decide que personas ve el selector.
 *
 * Con 40 miembros, listarlos todos es lento de renderizar y ademas inutil: la
 * mayoria tiene pocos issues. `members` llega ordenado por cantidad desde SQL,
 * asi que "los primeros" son "los que mas tienen".
 *
 * La busqueda ignora el limite a proposito y mira la lista COMPLETA: el buscador
 * se usa justo para encontrar a alguien que no esta entre los primeros, asi que
 * limitarlo tambien lo volveria inservible.
 */
export function visibleMembers(
  members: MemberOption[],
  query: string,
  limit: number,
): VisibleMembers {
  if (query.trim()) {
    return { shown: filterMembers(members, query), hidden: 0, truncated: false };
  }
  if (limit <= 0 || members.length <= limit) {
    return { shown: members, hidden: 0, truncated: false };
  }
  return {
    shown: members.slice(0, limit),
    hidden: members.length - limit,
    truncated: true,
  };
}
