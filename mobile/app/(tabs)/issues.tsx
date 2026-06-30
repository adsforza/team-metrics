import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { WipRiskCard } from '../../components/WipRiskCard';
import { AgingIssueRow } from '../../components/AgingIssueRow';
import { EmptyState } from '../../components/EmptyState';
import { useIssues } from '../../hooks/useIssues';

export default function IssuesScreen() {
  const { wipRisk, aging, hasData } = useIssues();

  if (!hasData) return <EmptyState />;

  const riskItems = wipRisk?.items ?? [];
  const excedidos = riskItems.filter(i => i.level === 'excedido');
  const enRiesgo = riskItems.filter(i => i.level === 'en_riesgo');

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* WIP en riesgo */}
      <Text style={s.sectionTitle}>
        WIP en riesgo ({riskItems.length})
      </Text>
      {riskItems.length === 0 ? (
        <View style={[Card.base, s.empty]}>
          <Text style={s.emptyText}>Sin issues en riesgo</Text>
        </View>
      ) : (
        <View style={s.cards}>
          {excedidos.map(i => <WipRiskCard key={i.issue_id} item={i} />)}
          {enRiesgo.map(i => <WipRiskCard key={i.issue_id} item={i} />)}
        </View>
      )}

      {/* Aging WIP */}
      <Text style={s.sectionTitle}>Aging WIP ({aging.length})</Text>
      <View style={Card.base}>
        {aging.length === 0 ? (
          <Text style={s.emptyText}>Sin issues sin movimiento</Text>
        ) : (
          aging.map(i => <AgingIssueRow key={i.issue_id} issue={i} />)
        )}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.text, marginTop: 4 },
  cards: { gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 12, color: Colors.textSubtle },
});
