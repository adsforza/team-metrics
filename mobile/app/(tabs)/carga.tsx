import { ScrollView, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography } from '../../lib/theme';
import { DateRangeBar } from '../../components/DateRangeBar';
import { EmptyState } from '../../components/EmptyState';
import { SquadCard } from '../../components/SquadCard';
import { useWorkload } from '../../hooks/useWorkload';
import { useFilterStore } from '../../store/filterStore';

export default function CargaScreen() {
  const { timeRange } = useFilterStore();
  const { workload, hasData } = useWorkload();
  const router = useRouter();

  if (!hasData || !workload) {
    return (
      <>
        <DateRangeBar />
        <EmptyState subtitle="Sincronizá para ver la carga de trabajo" />
      </>
    );
  }

  const goToRequester = (boardId: number, requester: string | null) => {
    // `__null__` es el literal que la pantalla de detalle espera para el bucket
    // "Sin dato". Las dos puntas tienen que usar el mismo o el drill-down de ese
    // bucket falla en silencio.
    const segment = requester !== null ? encodeURIComponent(requester) : '__null__';
    router.push(`/requester/${boardId}/${segment}` as never);
  };

  return (
    <>
      <DateRangeBar />
      <ScrollView style={s.root} contentContainerStyle={s.content}>
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
