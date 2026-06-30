import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../lib/theme';
import type { PersonScorecard, DimensionValue } from '../lib/types';

function DimCell({ dim }: { dim: DimensionValue }) {
  const color = dim.improving === 'better' ? Colors.success
    : dim.improving === 'worse' ? Colors.error
    : Colors.warning;
  const arrow = dim.trend === 'up' ? '↑' : dim.trend === 'down' ? '↓' : '→';
  return (
    <View style={s.dimCell}>
      <Text style={[s.dimArrow, { color }]}>{arrow}</Text>
      {dim.value != null && <Text style={s.dimValue}>{dim.value.toFixed(0)}</Text>}
    </View>
  );
}

interface Props {
  scorecard: PersonScorecard;
  isTeam?: boolean;
  onPress?: () => void;
}

export function ScorecardRow({ scorecard, isTeam, onPress }: Props) {
  return (
    <TouchableOpacity style={[s.row, isTeam && s.teamRow]} onPress={onPress}>
      <Text style={[s.name, isTeam && s.teamName]} numberOfLines={1}>
        {scorecard.member.display_name}
      </Text>
      <DimCell dim={scorecard.delivery} />
      <DimCell dim={scorecard.predictability} />
      <DimCell dim={scorecard.focus} />
      <DimCell dim={scorecard.flow} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  teamRow: { backgroundColor: Colors.bgMuted },
  name: { flex: 1, fontSize: 12, color: Colors.text },
  teamName: { fontWeight: '700', color: Colors.textMuted },
  dimCell: { width: 44, alignItems: 'center' },
  dimArrow: { fontSize: 14, fontWeight: '700' },
  dimValue: { fontSize: 9, color: Colors.textSubtle, marginTop: 1 },
});
