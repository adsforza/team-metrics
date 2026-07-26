import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Card } from '../../lib/theme';
import { WipRiskCard } from '../../components/WipRiskCard';
import { AgingIssueRow } from '../../components/AgingIssueRow';
import { EmptyState } from '../../components/EmptyState';
import { useIssues } from '../../hooks/useIssues';
import { JIRA_BASE_URL_KEY, getBaseUrl } from '../../lib/api';

export default function IssuesScreen() {
  const { wipRisk, aging, memberMap, hasData } = useIssues();
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

  useEffect(() => {
    (async () => {
      const cached = await AsyncStorage.getItem(JIRA_BASE_URL_KEY);
      if (cached) { setJiraBaseUrl(cached); return; }
      try {
        const base = await getBaseUrl();
        const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const cfg = await res.json() as { jiraBaseUrl: string };
          const url = cfg.jiraBaseUrl?.replace(/\/+$/, '') ?? '';
          if (url) { await AsyncStorage.setItem(JIRA_BASE_URL_KEY, url); setJiraBaseUrl(url); }
        }
      } catch { /* offline — share without link */ }
    })();
  }, []);

  if (!hasData) return <EmptyState />;

  const riskItems = wipRisk?.items ?? [];
  const excedidos = riskItems.filter(i => i.level === 'excedido');
  const enRiesgo = riskItems.filter(i => i.level === 'en_riesgo');

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      <Text style={s.sectionTitle}>WIP en riesgo ({riskItems.length})</Text>
      {riskItems.length === 0 ? (
        <View style={[Card.base, s.empty]}>
          <Text style={s.emptyText}>Sin issues en riesgo</Text>
        </View>
      ) : (
        <View style={s.cards}>
          {excedidos.map(i => (
            <WipRiskCard
              key={i.issue_id} item={i}
              memberName={i.assignee_id ? memberMap[i.assignee_id] : undefined}
              jiraBaseUrl={jiraBaseUrl}
            />
          ))}
          {enRiesgo.map(i => (
            <WipRiskCard
              key={i.issue_id} item={i}
              memberName={i.assignee_id ? memberMap[i.assignee_id] : undefined}
              jiraBaseUrl={jiraBaseUrl}
            />
          ))}
        </View>
      )}

      <Text style={s.sectionTitle}>Aging WIP ({aging.length})</Text>
      <View style={Card.base}>
        {aging.length === 0 ? (
          <Text style={s.emptyText}>Sin issues sin movimiento</Text>
        ) : (
          aging.map(i => (
            <AgingIssueRow
              key={i.issue_id} issue={i}
              memberName={i.assignee_id ? memberMap[i.assignee_id] : undefined}
              jiraBaseUrl={jiraBaseUrl}
            />
          ))
        )}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginTop: 4 },
  cards: { gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 14, color: Colors.textSubtle },
});
