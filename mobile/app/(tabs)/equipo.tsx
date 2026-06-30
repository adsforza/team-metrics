import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { ScorecardRow } from '../../components/ScorecardRow';
import { EmptyState } from '../../components/EmptyState';
import { useTeam } from '../../hooks/useTeam';
import type { PersonScorecard } from '../../lib/types';

const DIMS = ['Entrega', 'Pred.', 'Foco', 'Flujo'];

export default function EquipoScreen() {
  const { members, hasData } = useTeam();

  if (!hasData) return <EmptyState />;

  const team = members.find(m => m.member.id === '__team__') as PersonScorecard | undefined;
  const rest = members.filter(m => m.member.id !== '__team__');

  return (
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
        {rest.map(m => <ScorecardRow key={m.member.id} scorecard={m} />)}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerCell: { width: 44, fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', textAlign: 'center' },
  nameCell: { flex: 1, width: undefined, textAlign: 'left' },
});
