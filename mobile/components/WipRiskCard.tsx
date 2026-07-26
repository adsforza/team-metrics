import { View, Text, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Card } from '../lib/theme';
import type { WipRiskItem } from '../lib/types';

interface Props {
  item: WipRiskItem;
  memberName?: string;
  jiraBaseUrl?: string;
}

export function WipRiskCard({ item, memberName, jiraBaseUrl }: Props) {
  const isExcedido = item.level === 'excedido';
  const badgeColor = isExcedido ? Colors.error : Colors.warning;
  const progress = Math.min(item.ratio, 1.5);

  const handleShare = async () => {
    const status = isExcedido ? '🔴 Excedido' : '🟡 En riesgo';
    const assignee = memberName ? `\nAsignado: ${memberName}` : '';
    const link = jiraBaseUrl ? `\n${jiraBaseUrl}/browse/${item.issue_id}` : '';
    await Share.share({
      message: `${status}: ${item.title}\nTalla: ${item.talla} · ${item.age_days.toFixed(2)}d cursado / límite ${item.limit_days.toFixed(2)}d${assignee}${link}`,
    });
  };

  return (
    <View style={Card.base}>
      <View style={s.header}>
        <View style={s.titleWrap}>
          <Text style={s.issueId}>{item.issue_id}</Text>
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        </View>
        <View style={s.headerActions}>
          <View style={[s.badge, { backgroundColor: badgeColor + '30', borderColor: badgeColor }]}>
            <Text style={[s.badgeText, { color: badgeColor }]}>
              {isExcedido ? 'excedido' : 'en riesgo'}
            </Text>
          </View>
          <TouchableOpacity onPress={handleShare} style={s.shareBtn} hitSlop={8}>
            <Feather name="share-2" size={15} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={s.meta}>
        <View style={s.tallaChip}>
          <Text style={s.tallaText}>{item.talla}</Text>
        </View>
        <Text style={s.statusText}>{item.status}</Text>
        <Text style={s.days}>
          <Text style={[s.daysNum, { color: badgeColor }]}>{item.age_days.toFixed(2)}d</Text>
          <Text style={s.daysSep}> cursado · límite </Text>
          <Text style={s.daysNum}>{item.limit_days.toFixed(2)}d</Text>
        </Text>
      </View>
      {memberName && (
        <View style={s.assigneeRow}>
          <Feather name="user" size={12} color={Colors.primaryLight} />
          <Text style={s.assignee}>{memberName}</Text>
        </View>
      )}
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${Math.min(progress * 100, 100)}%` as any, backgroundColor: badgeColor }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  titleWrap: { flex: 1 },
  issueId: { fontSize: 12, fontWeight: '700', color: Colors.primaryLight, marginBottom: 2, letterSpacing: 0.5 },
  title: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  shareBtn: { padding: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  tallaChip: { backgroundColor: Colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tallaText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  statusText: { fontSize: 12, color: Colors.textMuted, flexShrink: 1 },
  days: { fontSize: 13 },
  daysNum: { fontWeight: '700', color: Colors.text },
  daysSep: { color: Colors.textMuted },
  assigneeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  assignee: { fontSize: 13, color: Colors.primaryLight, fontWeight: '500' },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
});
