import { ScrollView, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Typography } from '../../lib/theme';
import { EmptyState } from '../../components/EmptyState';
import { SquadCard } from '../../components/SquadCard';
import { useWorkload } from '../../hooks/useWorkload';
import { useFilterStore } from '../../store/filterStore';
import { encodeRequesterSegment } from '../../lib/workloadView';

export default function CargaScreen() {
  const { timeRange } = useFilterStore();
  const { workload, hasData } = useWorkload();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Sin DateRangeBar propia: TabHeader ya la renderiza para todas las solapas.
  if (!hasData || !workload) {
    return <EmptyState subtitle="Sincronizá para ver la carga de trabajo" />;
  }

  const goToRequester = (boardId: number, requester: string | null) => {
    router.push(`/requester/${boardId}/${encodeRequesterSegment(requester)}` as never);
  };

  return (
    <>
      {/* El padding inferior despeja la barra de solapas: sin esto la nota de los
          issues compartidos -que es la que explica por que los squads suman mas que
          el total- queda cortada detras de la barra y no se puede leer. */}
      <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 88 }]}>
        {workload.squads.map(squad => (
          <SquadCard
            key={squad.board_id}
            squad={squad}
            rangeLabel={timeRange}
            onPressRequester={(r) => goToRequester(squad.board_id, r)}
          />
        ))}
        {workload.totals.compartidos > 0 && (
          <Text style={Typography.label}>
            {workload.totals.compartidos} issues están en los dos boards y se cuentan en ambos squads.
          </Text>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
});
