import { View, Text, StyleSheet } from 'react-native';
import { Card, Colors } from '../lib/theme';
import type { ComparisonResult } from '../lib/types';

function arrow(delta: number) { return delta > 0 ? '↑' : delta < 0 ? '↓' : '→'; }
function deltaColor(delta: number, metric: 'throughput' | 'wip') {
  if (delta === 0) return Colors.textSubtle;
  if (metric === 'throughput') return delta > 0 ? Colors.success : Colors.error;
  return delta > 0 ? Colors.warning : Colors.success;
}

export function ComparisonWidget({ result }: { result: ComparisonResult }) {
  const fmtWeek = (monday: string) => {
    const [y, m, d] = monday.split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    const sun = new Date(y, m - 1, d + 6);
    const fmt = (dt: Date) => dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  };

  return (
    <View style={Card.base}>
      {/* Week band */}
      <View style={s.band}>
        <View style={s.bandLeft}>
          <Text style={s.bandLabel}>Esta semana</Text>
          <Text style={s.bandDate}>{fmtWeek(result.week)}</Text>
        </View>
        <Text style={s.vs}>vs</Text>
        <View style={s.bandRight}>
          <Text style={[s.bandLabel, { color: Colors.textSubtle }]}>Semana anterior</Text>
          <Text style={[s.bandDate, { color: Colors.textMuted }]}>{fmtWeek(result.prevWeek)}</Text>
        </View>
      </View>
      {/* Metrics */}
      <View style={s.metricsRow}>
        {(['throughput', 'wip'] as const).map(metric => {
          const p = result[metric];
          const col = deltaColor(p.delta, metric);
          return (
            <View key={metric} style={s.metricCell}>
              <Text style={s.metricLabel}>{metric === 'throughput' ? 'Throughput' : 'WIP'}</Text>
              <View style={s.metricValueRow}>
                <Text style={s.metricCurrent}>{p.current}</Text>
                <Text style={[s.metricDelta, { color: col }]}>
                  {arrow(p.delta)} {p.delta > 0 ? '+' : ''}{p.delta}
                  {p.deltaPct !== null ? ` (${p.deltaPct}%)` : ''}
                </Text>
                <Text style={s.metricPrev}>{p.previous}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  band: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 10 },
  bandLeft: { flex: 1 },
  bandRight: { flex: 1, alignItems: 'flex-end' },
  bandLabel: { fontSize: 9, color: Colors.primaryLight, textTransform: 'uppercase', letterSpacing: 0.8 },
  bandDate: { fontSize: 12, fontWeight: '600', color: Colors.text, marginTop: 2 },
  vs: { paddingHorizontal: 10, color: Colors.textSubtle, fontSize: 14 },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCell: { flex: 1 },
  metricLabel: { fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  metricCurrent: { fontSize: 24, fontWeight: '700', color: Colors.text },
  metricDelta: { fontSize: 11, fontWeight: '600' },
  metricPrev: { fontSize: 18, fontWeight: '700', color: Colors.textSubtle, marginLeft: 'auto' },
});
