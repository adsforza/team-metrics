import { filterMembers, personFilterLabel, visibleMembers } from '../lib/personFilter';

const members = [
  { id: 'u1', name: 'Ailen Rodríguez' },
  { id: 'u2', name: 'Emanuel Pozarnik' },
  { id: 'u3', name: 'Fabricio Linares' },
];

describe('filterMembers', () => {
  it('sin texto devuelve todos', () => {
    expect(filterMembers(members, '')).toHaveLength(3);
  });

  it('filtra por coincidencia parcial, sin importar mayusculas', () => {
    expect(filterMembers(members, 'eman').map(m => m.id)).toEqual(['u2']);
    expect(filterMembers(members, 'EMAN').map(m => m.id)).toEqual(['u2']);
  });

  it('matchea por apellido, no solo por el principio', () => {
    expect(filterMembers(members, 'linares').map(m => m.id)).toEqual(['u3']);
  });

  it('ignora acentos: buscar "rodriguez" encuentra "Rodríguez"', () => {
    expect(filterMembers(members, 'rodriguez').map(m => m.id)).toEqual(['u1']);
  });

  it('sin coincidencias devuelve lista vacia', () => {
    expect(filterMembers(members, 'zzz')).toEqual([]);
  });
});

describe('personFilterLabel', () => {
  it('sin nadie elegido dice Todos', () => {
    expect(personFilterLabel([], members)).toBe('Todos');
  });

  it('con una persona muestra su nombre', () => {
    expect(personFilterLabel(['u2'], members)).toBe('Emanuel Pozarnik');
  });

  it('con varias muestra la cuenta', () => {
    expect(personFilterLabel(['u1', 'u2'], members)).toBe('2 personas');
  });

  it('un id que ya no esta en la lista no rompe', () => {
    // Puede pasar si alguien sale del equipo con el filtro guardado.
    expect(personFilterLabel(['borrado'], members)).toBe('1 persona');
  });
});

describe('visibleMembers', () => {
  const muchos = Array.from({ length: 40 }, (_, i) => ({
    id: `u${i}`,
    name: `Persona ${String(i).padStart(2, '0')}`,
  }));

  it('sin busqueda muestra solo los primeros `limit`', () => {
    // Llegan ya ordenados por cantidad de issues desde SQL, asi que "los
    // primeros" son "los que mas tienen".
    const r = visibleMembers(muchos, '', 12);
    expect(r.shown).toHaveLength(12);
    expect(r.shown[0].id).toBe('u0');
    expect(r.hidden).toBe(28);
    expect(r.truncated).toBe(true);
  });

  it('con busqueda ignora el limite y busca en TODOS', () => {
    // Si la busqueda solo mirara los 12 visibles, el buscador seria inutil:
    // justo se usa para encontrar a alguien que no esta arriba.
    const r = visibleMembers(muchos, 'Persona 39', 12);
    expect(r.shown.map(m => m.id)).toEqual(['u39']);
    expect(r.truncated).toBe(false);
    expect(r.hidden).toBe(0);
  });

  it('si hay menos que el limite no marca truncado', () => {
    const r = visibleMembers(muchos.slice(0, 5), '', 12);
    expect(r.shown).toHaveLength(5);
    expect(r.hidden).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('limit 0 o negativo no esconde nada (guarda contra config rara)', () => {
    const r = visibleMembers(muchos, '', 0);
    expect(r.shown).toHaveLength(40);
    expect(r.truncated).toBe(false);
  });

  it('una busqueda sin resultados devuelve lista vacia, no todos', () => {
    const r = visibleMembers(muchos, 'zzz', 12);
    expect(r.shown).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
