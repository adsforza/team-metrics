import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { ScorecardRow } from '../../components/ScorecardRow';
import { PersonDetailModal } from '../../components/PersonDetailModal';
import { EmptyState } from '../../components/EmptyState';
import { useTeam } from '../../hooks/useTeam';
import type { PersonScorecard } from '../../lib/types';

type DimKey = 'delivery' | 'predictability' | 'focus' | 'flow' | 'regressions' | 'blocked';
type SortKey = 'name' | DimKey;

const COLS: { key: DimKey; label: string }[] = [
  { key: 'delivery', label: 'Entrega' },
  { key: 'predictability', label: 'Pred.' },
  { key: 'focus', label: 'Foco' },
  { key: 'flow', label: 'Flujo' },
  { key: 'regressions', label: 'Regr.' },
  { key: 'blocked', label: 'Bloq.' },
];

export default function EquipoScreen() {
  const { members, ctx, hasData } = useTeam();
  const [selected, setSelected] = useState<PersonScorecard | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  if (!hasData) return <EmptyState />;

  const team = members.find(m => m.member.id === '__team__') as PersonScorecard | undefined;
  const rest = members.filter(m => m.member.id !== '__team__');

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...rest].sort((a, b) => {
    let cmp: number;
    if (sortKey === 'name') {
      cmp = a.member.display_name.localeCompare(b.member.display_name);
    } else {
      const av = a[sortKey]?.value ?? null;
      const bv = b[sortKey]?.value ?? null;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) return 1;   // sin dato siempre al final
      else if (bv == null) return -1;
      else cmp = av - bv;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={s.content}>
        <View style={Card.base}>
          {/* Header row (clickable para ordenar) */}
          <View style={s.headerRow}>
            <TouchableOpacity style={s.nameCell} onPress={() => onSort('name')}>
              <Text style={[s.headerCell, s.nameHeaderText, sortKey === 'name' && s.headerActive]} numberOfLines={1}>
                Persona{arrow('name')}
              </Text>
            </TouchableOpacity>
            {COLS.map(c => (
              <TouchableOpacity key={c.key} style={s.dimHeader} onPress={() => onSort(c.key)}>
                <Text style={[s.headerCell, sortKey === c.key && s.headerActive]} numberOfLines={1}>
                  {c.label}{arrow(c.key)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Team aggregate row (fija arriba, no se ordena) */}
          {team && <ScorecardRow scorecard={team} isTeam />}
          {/* Member rows */}
          {sorted.map(m => (
            <ScorecardRow
              key={m.member.id}
              scorecard={m}
              onPress={() => setSelected(m)}
            />
          ))}
        </View>
        <Text style={s.hint}>Toca una columna para ordenar · toca una persona para ver el detalle</Text>
      </ScrollView>

      {ctx && (
        <PersonDetailModal
          person={selected}
          ctx={ctx}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 8 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  dimHeader: { width: 44, alignItems: 'center' },
  headerCell: { fontSize: 12, color: Colors.textSubtle, textTransform: 'uppercase', textAlign: 'center' },
  nameCell: { flex: 1 },
  nameHeaderText: { textAlign: 'left' },
  headerActive: { color: Colors.primary, fontWeight: '700' },
  hint: { fontSize: 12, color: Colors.textSubtle, textAlign: 'center', marginTop: 4 },
});
