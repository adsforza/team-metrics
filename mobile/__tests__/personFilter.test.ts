import { filterMembers, personFilterLabel } from '../lib/personFilter';

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
