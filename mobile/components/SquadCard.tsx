import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Card, Typography } from '../lib/theme';
import { splitRequesters, barPct } from '../lib/workloadView';
import type { WorkloadSquad, WorkloadRequester } from '@teammetrics/core/workload';

interface Props {
  squad: WorkloadSquad;
  rangeLabel: string;
  onPressRequester: (r: string | null) => void;
}

function requesterLabel(r: string | null): string {
  return r ?? 'Sin dato';
}

function RequesterRow({
  r, maxPedidos, onPress,
}: {
  r: WorkloadRequester;
  maxPedidos: number;
  onPress: (r: string | null) => void;
}) {
  const pct = barPct(r.pedidos, maxPedidos);
  const isNull = r.requester === null;
  const pendMuted = r.pendientes === 0;
  return (
    <TouchableOpacity style={s.reqRow} onPress={() => onPress(r.requester)}>
      <View style={s.reqLeft}>
        <Text style={[s.reqName, isNull && s.reqNameNull]} numberOfLines={1}>
          {requesterLabel(r.requester)}
        </Text>
        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${pct}%` }]} />
        </View>
      </View>
      <Text style={s.reqCount}>{r.pedidos}</Text>
      <View style={[s.badge, pendMuted && s.badgeMuted]}>
        <Text style={[s.badgeText, pendMuted && s.badgeTextMuted]}>{r.pendientes}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.textSubtle} />
    </TouchableOpacity>
  );
}

export function SquadCard({ squad, rangeLabel, onPressRequester }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { top: top3, rest, restPedidos, restPendientes, maxPedidos } = splitRequesters(squad.requesters);

  return (
    <View style={Card.base}>
      <View style={s.header}>
        <View style={s.dot} />
        <Text style={Typography.heading}>{squad.name}</Text>
      </View>

      <View style={s.totalsRow}>
        <View style={s.totalCell}>
          <Text style={Typography.label}>Pedidos {rangeLabel}</Text>
          <Text style={[Typography.number, s.textNumber]}>{squad.pedidos}</Text>
        </View>
        <View style={s.totalCell}>
          <Text style={Typography.label}>Pendientes hoy</Text>
          <Text style={[Typography.number, s.warningNumber]}>{squad.pendientes}</Text>
        </View>
      </View>

      {top3.map(r => (
        <RequesterRow key={String(r.requester)} r={r} maxPedidos={maxPedidos} onPress={onPressRequester} />
      ))}

      {rest.length > 0 && (
        <TouchableOpacity style={s.othersRow} onPress={() => setExpanded(e => !e)}>
          <Text style={s.othersText}>Otros {rest.length} equipos</Text>
          <Text style={s.othersMeta}>{restPedidos} pedidos · {restPendientes} pendientes</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSubtle} />
        </TouchableOpacity>
      )}

      {expanded && rest.length > 0 && (
        <ScrollView style={s.othersList} nestedScrollEnabled>
          {rest.map(r => (
            <RequesterRow key={String(r.requester)} r={r} maxPedidos={maxPedidos} onPress={onPressRequester} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  totalsRow: { flexDirection: 'row', gap: 24, marginBottom: 12 },
  totalCell: { gap: 2 },
  textNumber: { color: Colors.text },
  warningNumber: { color: Colors.warning },
  reqRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  reqLeft: { flex: 1, gap: 4 },
  reqName: { fontSize: 14, color: Colors.text },
  reqNameNull: { fontStyle: 'italic', color: Colors.textMuted },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2, backgroundColor: Colors.primary },
  reqCount: { fontSize: 14, color: Colors.text, minWidth: 28, textAlign: 'right' },
  badge: {
    minWidth: 26, alignItems: 'center', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: Colors.warning + '20', borderWidth: 1, borderColor: Colors.warning,
  },
  badgeMuted: { backgroundColor: 'transparent', borderColor: Colors.textSubtle },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.warning },
  badgeTextMuted: { color: Colors.textSubtle },
  othersRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  othersText: { flex: 1, fontSize: 14, color: Colors.textMuted },
  othersMeta: { fontSize: 12, color: Colors.textSubtle },
  othersList: { maxHeight: 200 },
});
