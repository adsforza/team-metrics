import { describe, it, expect } from 'vitest';
import { matchesAssignees } from './filters';

describe('matchesAssignees', () => {
  it('sin filtro (undefined) matchea todo, incluso sin asignar', () => {
    expect(matchesAssignees('u1', undefined)).toBe(true);
    expect(matchesAssignees(null, undefined)).toBe(true);
  });

  it('lista vacia NO matchea nada', () => {
    // Convencion del core, opuesta a la del store. Se usa para el agregado de
    // un equipo sin miembros: no debe traer todos los issues por accidente.
    expect(matchesAssignees('u1', [])).toBe(false);
    expect(matchesAssignees(null, [])).toBe(false);
  });

  it('una persona matchea solo a esa', () => {
    expect(matchesAssignees('u1', ['u1'])).toBe(true);
    expect(matchesAssignees('u2', ['u1'])).toBe(false);
  });

  it('varias personas matchean a cualquiera de la lista', () => {
    expect(matchesAssignees('u2', ['u1', 'u2', 'u3'])).toBe(true);
    expect(matchesAssignees('u9', ['u1', 'u2', 'u3'])).toBe(false);
  });

  it('un issue sin asignar nunca matchea una lista con gente', () => {
    expect(matchesAssignees(null, ['u1'])).toBe(false);
  });
});
