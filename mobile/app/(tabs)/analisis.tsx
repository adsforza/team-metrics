import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { CartesianChart, Area, Scatter } from 'victory-native';
import { Colors, Card, Typography } from '../../lib/theme';
import { BottleneckRow } from '../../components/BottleneckRow';
import { ForecastCard } from '../../components/ForecastCard';
import { EmptyState } from '../../components/EmptyState';
import { useAnalysis } from '../../hooks/useAnalysis';

const CFD_COLORS = ['#718096', '#9F7AEA', '#3182CE', '#3182CE', '#68D391'];

export default function AnalisisScreen() {
  const { bottleneck, forecast, cfd, issues, hasData } = useAnalysis();

  if (!hasData) return <EmptyState />;

  const scatterData = issues
    .filter(i => i.ct_days != null && i.last_transition_at)
    .map(i => ({
      ts: new Date(i.last_transition_at!).getTime(),
      days: i.ct_days!,
    }));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* Bottleneck */}
      {bottleneck && bottleneck.states.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cuellos de botella</Text>
          <View style={Card.base}>
            {bottleneck.states.map(st => (
              <BottleneckRow key={st.status} state={st} />
            ))}
          </View>
        </>
      )}

      {/* Forecast */}
      {forecast && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Forecast Monte Carlo</Text>
          <ForecastCard forecast={forecast} />
        </>
      )}

      {/* CFD */}
      {cfd.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cumulative Flow Diagram</Text>
          <View style={[Card.base, { height: 180 }]}>
            <CartesianChart
              data={cfd.map(p => ({ ...p, date: p.date.slice(5) }))}
              xKey="date"
              yKeys={['todo', 'in_progress', 'in_review', 'in_qa', 'done']}
            >
              {({ points, chartBounds }) => (
                <>
                  {(['todo', 'in_progress', 'in_review', 'in_qa', 'done'] as const).map((key, i) => (
                    <Area
                      key={key}
                      points={points[key]}
                      y0={chartBounds.bottom}
                      color={CFD_COLORS[i]}
                      opacity={0.75}
                    />
                  ))}
                </>
              )}
            </CartesianChart>
          </View>
        </>
      )}

      {/* Scatter cycle time */}
      {scatterData.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cycle Time</Text>
          <View style={[Card.base, { height: 180 }]}>
            <CartesianChart
              data={scatterData}
              xKey="ts"
              yKeys={['days']}
              domainPadding={{ top: 16 }}
            >
              {({ points }) => (
                <Scatter
                  points={points.days}
                  color={Colors.primary}
                  radius={4}
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
  sectionLabel: { marginTop: 4 },
});
