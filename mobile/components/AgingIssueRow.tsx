import { View, Text, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import type { AgingIssue } from '../lib/types';

interface Props {
  issue: AgingIssue;
  memberName?: string;
  jiraBaseUrl?: string;
}

export function AgingIssueRow({ issue, memberName, jiraBaseUrl }: Props) {
  const handleShare = async () => {
    const assignee = memberName ? ` · ${memberName}` : '';
    const link = jiraBaseUrl ? `\n${jiraBaseUrl}/browse/${issue.issue_id}` : '';
    await Share.share({
      message: `⏳ Sin movimiento: ${issue.title}\n${issue.status} · ${issue.talla ?? '?'}${assignee} · ${issue.days_in_status}d detenido${link}`,
    });
  };

  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.issueId}>{issue.issue_id}</Text>
        <Text style={s.title} numberOfLines={1}>{issue.title}</Text>
        <View style={s.metaRow}>
          <Text style={s.meta}>{issue.status} · {issue.talla ?? '?'}</Text>
          {memberName && (
            <>
              <Text style={s.metaSep}>·</Text>
              <Feather name="user" size={11} color={Colors.primaryLight} />
              <Text style={s.memberName}>{memberName}</Text>
            </>
          )}
        </View>
      </View>
      <View style={s.right}>
        <Text style={s.days}>{issue.days_in_status}d</Text>
        <TouchableOpacity onPress={handleShare} style={s.shareBtn} hitSlop={8}>
          <Feather name="share-2" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
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
  issueId: { fontSize: 12, fontWeight: '700', color: Colors.primaryLight, marginBottom: 1, letterSpacing: 0.5 },
  title: { fontSize: 14, color: Colors.text, marginBottom: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: Colors.textMuted },
  metaSep: { fontSize: 12, color: Colors.textSubtle },
  memberName: { fontSize: 13, color: Colors.primaryLight, fontWeight: '500' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 8 },
  days: { fontSize: 15, fontWeight: '700', color: Colors.textMuted, minWidth: 32, textAlign: 'right' },
  shareBtn: { padding: 2 },
});
