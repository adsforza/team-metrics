import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../lib/theme';
import type { PersonScorecard, DimensionValue } from '../lib/types';

function DimCell({ dim, pct }: { dim: DimensionValue | undefined; pct?: boolean }) {
  if (!dim) return <View style={s.dimCell} />;
  const color = dim.improving === 'better' ? Colors.success
    : dim.improving === 'worse' ? Colors.error
    : Colors.warning;
  const arrow = dim.trend === 'up' ? '↑' : dim.trend === 'down' ? '↓' : '→';
  const valStr = dim.value != null
    ? pct ? `${Math.round(dim.value)}%` : dim.value.toFixed(1)
    : null;
  return (
    <View style={s.dimCell}>
      <Text style={[s.dimArrow, { color }]}>{arrow}</Text>
      {valStr != null && <Text style={s.dimValue}>{valStr}</Text>}
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
      <DimCell dim={scorecard.flow} pct />
      <DimCell dim={scorecard.regressions} pct />
      <DimCell dim={scorecard.blocked} pct />
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
  name: { flex: 1, fontSize: 14, color: Colors.text },
  teamName: { fontWeight: '700', color: Colors.textMuted },
  dimCell: { width: 44, alignItems: 'center' },
  dimArrow: { fontSize: 15, fontWeight: '700' },
  dimValue: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
});
