import { View, Text, StyleSheet } from 'react-native';
import { Colors, Card } from '../lib/theme';

interface Props {
  label: string;
  value: number | string | null;
  sub?: string;
  color?: string;
}

export function KPICard({ label, value, sub, color = Colors.text }: Props) {
  return (
    <View style={[Card.base, s.card]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, { color }]}>{value ?? '—'}</Text>
      {sub && <Text style={s.sub}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, minWidth: '45%' },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textMuted, marginBottom: 4 },
  value: { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  sub: { fontSize: 15, color: Colors.textMuted, marginTop: 4 },
});
