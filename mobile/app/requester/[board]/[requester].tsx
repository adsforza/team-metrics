import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Typography } from '../../../lib/theme';
import { parseRequesterSegment, AGING_THRESHOLD_DAYS } from '../../../lib/workloadView';
import { useRequesterDetail, useRequesterScreenData } from '../../../hooks/useRequesterDetail';
import { useFilterStore, dateRangeFor } from '../../../store/filterStore';
import { WorkloadIssueRow } from '../../../components/WorkloadIssueRow';

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function RequesterDetailScreen() {
  const params = useLocalSearchParams<{ board: string; requester: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<'pendientes' | 'todos'>('pendientes');

  const boardParam = firstOf(params.board);
  const board = Number(boardParam);
  // expo-router ya decodifica el segmento dinamico al leerlo: no hay que volver a
  // llamar decodeURIComponent aca (romperia nombres con % literal, ver lib/workloadView).
  const requester = parseRequesterSegment(firstOf(params.requester));

  const { timeRange } = useFilterStore();
  const { from, to } = useMemo(() => dateRangeFor(timeRange), [timeRange]);

  // Una sola lectura para toda la pantalla (issues + nombre del board + team_members
  // crudo), compartida entre los dos scopes de abajo.
  const { issues, boardName, memberMap } = useRequesterScreenData(board);

  const pendientes = useRequesterDetail(issues, { board, requester, scope: 'pendientes', from, to });
  const todos = useRequesterDetail(issues, { board, requester, scope: 'todos', from, to });
  const active = scope === 'pendientes' ? pendientes.detail : todos.detail;

  const requesterLabel = requester ?? 'Sin dato';
  const resumen = active?.resumen;
  const resumenParts = resumen
    ? [
        resumen.abiertos > 0 ? `${resumen.abiertos} abiertos` : null,
        resumen.estancados > 0 ? `${resumen.estancados} sin arrancar hace +${AGING_THRESHOLD_DAYS}d` : null,
        resumen.p1 > 0 ? `${resumen.p1} son P1` : null,
        resumen.edad_max > 0 ? `más viejo ${resumen.edad_max}d` : null,
        // edad_p50 puede salir fraccionario (mediana de cantidad par de abiertos); el
        // core lo deja crudo a propósito (misma definición que cycle_time_p50) y la
        // UI redondea solo para mostrar.
        resumen.edad_p50 > 0 ? `mediana ${Math.round(resumen.edad_p50)}d` : null,
      ].filter((p): p is string => p !== null)
    : [];

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={s.backBtn}>‹ Carga</Text>
        </TouchableOpacity>
        <Text style={s.breadcrumb}>{boardName} · solicitante</Text>
        <Text style={s.title} numberOfLines={1}>{requesterLabel}</Text>
      </View>

      <View style={s.toggleRow}>
        <TouchableOpacity
          style={[s.toggleBtn, scope === 'pendientes' && s.toggleBtnActive]}
          onPress={() => setScope('pendientes')}
        >
          <Text style={[s.toggleText, scope === 'pendientes' && s.toggleTextActive]}>
            Pendientes {pendientes.detail?.issues.length ?? 0}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleBtn, scope === 'todos' && s.toggleBtnActive]}
          onPress={() => setScope('todos')}
        >
          <Text style={[s.toggleText, scope === 'todos' && s.toggleTextActive]}>
            Todos {todos.detail?.issues.length ?? 0}
          </Text>
        </TouchableOpacity>
      </View>

      {resumenParts.length > 0 && (
        <Text style={[Typography.bodyMuted, s.resumen]}>{resumenParts.join(' · ')}</Text>
      )}

      <FlatList
        style={s.list}
        data={active?.issues ?? []}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <WorkloadIssueRow
            issue={item}
            memberName={item.assignee_id ? memberMap[item.assignee_id] : undefined}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 2,
  },
  backBtn: { fontSize: 15, color: Colors.primaryLight, fontWeight: '600', marginBottom: 4 },
  breadcrumb: { fontSize: 12, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: 13, color: Colors.textMuted },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  resumen: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { flex: 1 },
});
