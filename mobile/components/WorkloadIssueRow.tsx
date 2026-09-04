import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import { ageColor } from '../lib/workloadView';
import type { WorkloadIssue } from '@teammetrics/core/workload';

interface Props {
  issue: WorkloadIssue;
  memberName?: string;
}

export function WorkloadIssueRow({ issue, memberName }: Props) {
  return (
    <View style={s.row}>
      <View style={s.line1}>
        <Text style={s.id}>{issue.id}</Text>
        <View style={s.chip}>
          <Text style={s.chipText}>{issue.status}</Text>
        </View>
        <Text style={[s.age, { color: ageColor(issue.edad_dias) }]}>{issue.edad_dias}d</Text>
      </View>

      <Text style={s.title} numberOfLines={2}>{issue.title}</Text>

      <View style={s.line3}>
        <Text style={s.member}>{memberName ?? 'sin asignar'}</Text>
        {issue.priority && (
          <View style={s.chip}>
            <Text style={s.chipText}>{issue.priority}</Text>
          </View>
        )}
        {issue.talla !== null && (
          <View style={s.chip}>
            <Text style={s.chipText}>{issue.talla}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  id: { fontSize: 12, fontWeight: '700', color: Colors.primaryLight, letterSpacing: 0.5 },
  age: { marginLeft: 'auto', fontSize: 13, fontWeight: '700' },
  title: { fontSize: 14, color: Colors.text },
  line3: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  member: { fontSize: 12, color: Colors.textMuted, marginRight: 2 },
  chip: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
});
