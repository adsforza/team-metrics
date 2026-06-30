import { View, Text, StyleSheet } from 'react-native';
import { Colors, Card } from '../lib/theme';
import type { WipRiskItem } from '../lib/types';

export function WipRiskCard({ item }: { item: WipRiskItem }) {
  const isExcedido = item.level === 'excedido';
  const badgeColor = isExcedido ? Colors.error : Colors.warning;
  const progress = Math.min(item.ratio, 1.5);

  return (
    <View style={Card.base}>
      <View style={s.header}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <View style={[s.badge, { backgroundColor: badgeColor + '30', borderColor: badgeColor }]}>
          <Text style={[s.badgeText, { color: badgeColor }]}>
            {isExcedido ? 'excedido' : 'en riesgo'}
          </Text>
        </View>
      </View>
      <View style={s.meta}>
        <View style={s.tallaChip}>
          <Text style={s.tallaText}>{item.talla}</Text>
        </View>
        <Text style={s.days}>{item.age_days}d / límite {item.limit_days}d</Text>
      </View>
      {/* Progress bar */}
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${Math.min(progress * 100, 100)}%` as any, backgroundColor: badgeColor }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  title: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tallaChip: { backgroundColor: Colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tallaText: { fontSize: 10, color: Colors.textMuted },
  days: { fontSize: 11, color: Colors.textSubtle },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
});
