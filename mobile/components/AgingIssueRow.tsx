import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import type { AgingIssue } from '../lib/types';

export function AgingIssueRow({ issue }: { issue: AgingIssue }) {
  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.title} numberOfLines={1}>{issue.title}</Text>
        <Text style={s.meta}>{issue.status} · {issue.talla ?? '?'}</Text>
      </View>
      <Text style={s.days}>{issue.days_in_status}d</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  left: { flex: 1 },
  title: { fontSize: 12, color: Colors.text, marginBottom: 2 },
  meta: { fontSize: 10, color: Colors.textSubtle },
  days: { fontSize: 14, fontWeight: '700', color: Colors.textMuted, minWidth: 36, textAlign: 'right' },
});
