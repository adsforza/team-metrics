import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Colors, Card, Typography } from '../../lib/theme';
import { BottleneckRow } from '../../components/BottleneckRow';
import { ForecastCard } from '../../components/ForecastCard';
import { EmptyState } from '../../components/EmptyState';
import { useAnalysis } from '../../hooks/useAnalysis';
import type { CFDPoint, Issue } from '../../lib/types';

// ── CFD ──────────────────────────────────────────────────────────────────────

const WIP_KEYS: (keyof CFDPoint)[] = ['in_progress', 'in_review', 'in_qa'];
const WIP_LABELS: Record<string, string> = {
  in_progress: 'En progreso',
  in_review:   'En revisión',
  in_qa:       'En QA',
};
const WIP_COLORS: Record<string, string> = {
  in_progress: '#3182CE',
  in_review:   '#9F7AEA',
  in_qa:       '#38B2AC',
};

function CfdChart({ data }: { data: CFDPoint[] }) {
  if (data.length === 0) return null;

  // Sample to ~14 evenly spaced points
  const sample: CFDPoint[] = [];
  const step = Math.max(1, Math.floor(data.length / 14));
  for (let i = 0; i < data.length; i += step) sample.push(data[i]);
  if (sample[sample.length - 1] !== data[data.length - 1]) sample.push(data[data.length - 1]);

  const BAR_H = 100;
  const maxWip = Math.max(...sample.map(p => WIP_KEYS.reduce((s, k) => s + (p[k] as number), 0)), 1);
  const latest = data[data.length - 1];

  function fmtDate(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  return (
    <View style={Card.base}>
      {/* Stacked bar chart */}
      <View style={cf.chartRow}>
        {sample.map((p, i) => {
          const total = WIP_KEYS.reduce((s, k) => s + (p[k] as number), 0);
          const barH = Math.max((total / maxWip) * BAR_H, total > 0 ? 2 : 0);
          const showLabel = i === 0 || i === Math.floor(sample.length / 2) || i === sample.length - 1;
          return (
            <View key={p.date} style={cf.col}>
              <View style={[cf.barWrap, { height: BAR_H }]}>
                <View style={[cf.stack, { height: barH }]}>
                  {WIP_KEYS.map(k => {
                    const val = p[k] as number;
                    if (val === 0) return null;
                    const segH = (val / Math.max(total, 1)) * barH;
                    return <View key={k} style={{ width: '100%', height: segH, backgroundColor: WIP_COLORS[k] }} />;
                  })}
                </View>
              </View>
              {showLabel && <Text style={cf.dateLabel}>{fmtDate(p.date)}</Text>}
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={cf.legend}>
        {WIP_KEYS.map(k => (
          <View key={k} style={cf.legendItem}>
            <View style={[cf.legendDot, { backgroundColor: WIP_COLORS[k] }]} />
            <Text style={cf.legendText}>{WIP_LABELS[k]}</Text>
          </View>
        ))}
      </View>

      {/* Current snapshot */}
      <View style={cf.snapshot}>
        {WIP_KEYS.map(k => (
          <View key={k} style={cf.snapshotItem}>
            <Text style={[cf.snapshotNum, { color: WIP_COLORS[k] }]}>{latest[k] as number}</Text>
            <Text style={cf.snapshotLabel}>{WIP_LABELS[k]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cf = StyleSheet.create({
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginBottom: 8 },
  col: { flex: 1, alignItems: 'center' },
  barWrap: { justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  stack: { width: '80%', overflow: 'hidden', borderRadius: 2, justifyContent: 'flex-end' },
  dateLabel: { fontSize: 9, color: Colors.textSubtle, marginTop: 3, textAlign: 'center' },
  legend: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: Colors.textMuted },
  snapshot: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12, gap: 4 },
  snapshotItem: { flex: 1, alignItems: 'center', gap: 2 },
  snapshotNum: { fontSize: 22, fontWeight: '700' },
  snapshotLabel: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },
});

// ── Scatter ───────────────────────────────────────────────────────────────────

function CycleTimeScatter({ issues }: { issues: Issue[] }) {
  const pts = issues
    .filter(i => i.ct_days != null && i.last_transition_at)
    .map(i => ({ ts: new Date(i.last_transition_at!).getTime(), days: i.ct_days! }));

  if (pts.length === 0) return null;

  const W = 280, H = 120;
  const minTs = Math.min(...pts.map(p => p.ts));
  const maxTs = Math.max(...pts.map(p => p.ts));
  const maxDays = Math.max(...pts.map(p => p.days), 1);
  const spanTs = Math.max(maxTs - minTs, 1);

  const p50Sorted = [...pts].sort((a, b) => a.days - b.days);
  const p50 = p50Sorted[Math.floor(p50Sorted.length * 0.5)]?.days ?? 0;
  const p85 = p50Sorted[Math.floor(p50Sorted.length * 0.85)]?.days ?? 0;

  function fmtTs(ms: number) {
    const d = new Date(ms);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  return (
    <View style={Card.base}>
      <View style={{ height: H, position: 'relative', marginBottom: 20 }}>
        {/* P85 line */}
        <View style={[sc.refLine, { bottom: (p85 / maxDays) * H, borderColor: Colors.warning + '60' }]} />
        {/* P50 line */}
        <View style={[sc.refLine, { bottom: (p50 / maxDays) * H, borderColor: Colors.primary + '60' }]} />
        {/* Dots */}
        {pts.map((p, i) => (
          <View
            key={i}
            style={[sc.dot, {
              left: ((p.ts - minTs) / spanTs) * (W - 8),
              bottom: Math.min((p.days / maxDays) * H, H - 4),
              backgroundColor: p.days > p85 ? Colors.error : p.days > p50 ? Colors.warning : Colors.success,
            }]}
          />
        ))}
        {/* Y labels */}
        <Text style={[sc.yLabel, { bottom: (p85 / maxDays) * H }]}>p85 {p85.toFixed(1)}d</Text>
        <Text style={[sc.yLabel, { bottom: (p50 / maxDays) * H }]}>p50 {p50.toFixed(1)}d</Text>
      </View>
      {/* X axis labels */}
      <View style={sc.xRow}>
        <Text style={sc.xLabel}>{fmtTs(minTs)}</Text>
        <Text style={sc.xLabel}>{fmtTs((minTs + maxTs) / 2)}</Text>
        <Text style={sc.xLabel}>{fmtTs(maxTs)}</Text>
      </View>
    </View>
  );
}

const sc = StyleSheet.create({
  refLine: { position: 'absolute', left: 0, right: 0, height: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, opacity: 0.8 },
  yLabel: { position: 'absolute', right: 0, fontSize: 9, color: Colors.textMuted },
  xRow: { flexDirection: 'row', justifyContent: 'space-between' },
  xLabel: { fontSize: 9, color: Colors.textSubtle },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AnalisisScreen() {
  const { bottleneck, forecast, cfd, issues, hasData } = useAnalysis();

  if (!hasData) return <EmptyState />;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

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

      {forecast && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Forecast Monte Carlo</Text>
          <ForecastCard forecast={forecast} />
        </>
      )}

      {cfd.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cumulative Flow Diagram</Text>
          <CfdChart data={cfd} />
        </>
      )}

      {issues.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cycle Time</Text>
          <CycleTimeScatter issues={issues} />
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
