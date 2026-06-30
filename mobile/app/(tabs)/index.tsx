import { ScrollView, View, Text, StyleSheet, Dimensions } from 'react-native';
import { CartesianChart, Bar } from 'victory-native';
import { Colors, Typography } from '../../lib/theme';
import { KPICard } from '../../components/KPICard';
import { ComparisonWidget } from '../../components/ComparisonWidget';
import { EmptyState } from '../../components/EmptyState';
import { useKPIs } from '../../hooks/useKPIs';

const CHART_WIDTH = Dimensions.get('window').width - 32;

export default function InicioScreen() {
  const { kpi, throughput, comparison, hasData } = useKPIs();

  if (!hasData) return <EmptyState />;

  const chartData = throughput.map(w => ({
    week: w.week.slice(5),  // MM-DD
    count: w.count,
  }));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* KPIs */}
      <View style={s.kpiGrid}>
        <KPICard label="WIP" value={kpi?.wip ?? null} />
        <KPICard label="Throughput" value={kpi?.throughput ?? null} />
        <KPICard
          label="Cycle P50"
          value={kpi?.cycle_time_p50 != null ? `${kpi.cycle_time_p50}d` : null}
        />
        <KPICard
          label="Bloqueados"
          value={kpi?.blocked_count ?? null}
          color={kpi && kpi.blocked_count > 0 ? Colors.error : Colors.text}
        />
      </View>

      {/* Comparativa semanal */}
      {comparison && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Comparativa semanal</Text>
          <ComparisonWidget result={comparison} />
        </>
      )}

      {/* Throughput chart */}
      {chartData.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Throughput semanal</Text>
          <View style={s.chartCard}>
            <CartesianChart
              data={chartData}
              xKey="week"
              yKeys={['count']}
              domainPadding={{ left: 12, right: 12, top: 16 }}
            >
              {({ points, chartBounds }) => (
                <Bar
                  points={points.count}
                  chartBounds={chartBounds}
                  color={Colors.primary}
                  roundedCorners={{ topLeft: 3, topRight: 3 }}
                />
              )}
            </CartesianChart>
          </View>
        </>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { marginTop: 4 },
  chartCard: {
    backgroundColor: Colors.bgCard, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, height: 180,
  },
});
