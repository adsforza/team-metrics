import { View, Text, StyleSheet } from 'react-native';
import { Colors, Card } from '../lib/theme';

interface Props {
  label: string;
  value: number | string | null;
  color?: string;
}

export function KPICard({ label, value, color = Colors.text }: Props) {
  return (
    <View style={Card.base}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, { color }]}>{value ?? '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  value: { fontSize: 28, fontWeight: '700', lineHeight: 32 },
});
