import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { ScorecardRow } from '../../components/ScorecardRow';
import { PersonDetailModal } from '../../components/PersonDetailModal';
import { EmptyState } from '../../components/EmptyState';
import { useTeam } from '../../hooks/useTeam';
import type { PersonScorecard } from '../../lib/types';

const DIMS = ['Entrega', 'Pred.', 'Foco', 'Flujo', 'Regr.', 'Bloq.'];

export default function EquipoScreen() {
  const { members, ctx, hasData } = useTeam();
  const [selected, setSelected] = useState<PersonScorecard | null>(null);

  if (!hasData) return <EmptyState />;

  const team = members.find(m => m.member.id === '__team__') as PersonScorecard | undefined;
  const rest = members.filter(m => m.member.id !== '__team__');

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={s.content}>
        <View style={Card.base}>
          {/* Header row */}
          <View style={s.headerRow}>
            <Text style={[s.headerCell, s.nameCell]}>Persona</Text>
            {DIMS.map(d => <Text key={d} style={s.headerCell}>{d}</Text>)}
          </View>
          {/* Team aggregate row */}
          {team && <ScorecardRow scorecard={team} isTeam />}
          {/* Member rows */}
          {rest.map(m => (
            <ScorecardRow
              key={m.member.id}
              scorecard={m}
              onPress={() => setSelected(m)}
            />
          ))}
        </View>
        <Text style={s.hint}>Toca una persona para ver el detalle</Text>
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
  headerCell: { width: 44, fontSize: 13, color: Colors.textSubtle, textTransform: 'uppercase', textAlign: 'center' },
  nameCell: { flex: 1, width: undefined, textAlign: 'left' },
  hint: { fontSize: 12, color: Colors.textSubtle, textAlign: 'center', marginTop: 4 },
});
