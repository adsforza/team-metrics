import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import type { BottleneckState, BottleneckScore } from '../lib/types';

const SCORE_COLOR: Record<BottleneckScore, string> = {
  crítico: Colors.error,
  alto: Colors.warning,
  medio: '#60A5FA',
  normal: Colors.textSubtle,
};

export function BottleneckRow({ state }: { state: BottleneckState }) {
  const color = SCORE_COLOR[state.score];
  const pct = Math.round(state.detail.pct_of_wip * 100);
  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.status}>{state.status}</Text>
        <Text style={s.meta}>{state.queue_size} issues · {state.avg_days != null ? `${state.avg_days.toFixed(1)}d` : '—'}</Text>
        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: color }]} />
        </View>
      </View>
      <View style={[s.badge, { backgroundColor: color + '20', borderColor: color }]}>
        <Text style={[s.badgeText, { color }]}>{state.score}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  left: { flex: 1 },
  status: { fontSize: 12, color: Colors.text, marginBottom: 2 },
  meta: { fontSize: 10, color: Colors.textSubtle, marginBottom: 4 },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
});
