import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Colors, Card, Typography } from '../../lib/theme';
import { BottleneckRow } from '../../components/BottleneckRow';
import { ForecastCard } from '../../components/ForecastCard';
import { EmptyState } from '../../components/EmptyState';
import { useAnalysis } from '../../hooks/useAnalysis';
import { useFilterStore, dateRangeFor } from '../../store/filterStore';
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
      {/* Stacked bar chart — todas las barras comparten el mismo baseline (alto fijo BAR_H) */}
      <View style={cf.chartRow}>
        {sample.map((p) => {
          const total = WIP_KEYS.reduce((s, k) => s + (p[k] as number), 0);
          const barH = Math.max((total / maxWip) * BAR_H, total > 0 ? 2 : 0);
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
            </View>
          );
        })}
      </View>
      {/* Fechas en fila aparte: no empujan las barras, así el baseline queda parejo y se
          ve si el WIP se acumula. */}
      <View style={cf.labelsRow}>
        {sample.map((p, i) => {
          const showLabel = i === 0 || i === Math.floor(sample.length / 2) || i === sample.length - 1;
          return (
            <View key={p.date} style={cf.col}>
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
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  labelsRow: { flexDirection: 'row', gap: 3, marginBottom: 8, marginTop: 3 },
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

// Scatter vertical (rotado 90° para aprovechar el alto del teléfono):
//   eje Y = tiempo (el PERÍODO medido por el filtro, viejo arriba → nuevo abajo)
//   eje X = cycle time en días (0 izq → max der), con líneas p50/p85 verticales.
function CycleTimeScatter({ issues, range }: { issues: Issue[]; range: { from: string; to: string } }) {
  const [plotW, setPlotW] = useState(0);

  const pts = issues
    .filter(i => i.ct_days != null && i.last_transition_at)
    .map(i => ({ ts: new Date(i.last_transition_at!).getTime(), days: i.ct_days! }));

  if (pts.length === 0) return null;

  const H = 300;
  const maxDays = Math.max(...pts.map(p => p.days), 1);

  // Eje de tiempo = el período medido (filtro), no el min/max de los puntos.
  const ps = Date.parse(range.from + 'T00:00:00Z');
  const pe = Date.parse(range.to + 'T23:59:59Z');
  const start = Number.isNaN(ps) ? Math.min(...pts.map(p => p.ts)) : ps;
  const end = Number.isNaN(pe) ? Math.max(...pts.map(p => p.ts)) : pe;
  const span = Math.max(end - start, 1);

  const sorted = [...pts].sort((a, b) => a.days - b.days);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]?.days ?? 0;
  const p85 = sorted[Math.floor(sorted.length * 0.85)]?.days ?? 0;

  const fmtTs = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  const topFor = (ts: number) => Math.min(Math.max(((ts - start) / span) * (H - 6), 0), H - 6);

  return (
    <View style={Card.base}>
      <View style={{ flexDirection: 'row' }}>
        {/* Eje de tiempo (vertical): el período medido */}
        <View style={{ width: 46, height: H }}>
          <Text style={[sc.tLabel, { top: 0 }]}>{fmtTs(start)}</Text>
          <Text style={[sc.tLabel, { top: H / 2 - 6 }]}>{fmtTs((start + end) / 2)}</Text>
          <Text style={[sc.tLabel, { top: H - 12 }]}>{fmtTs(end)}</Text>
        </View>
        {/* Plot */}
        <View
          style={{ flex: 1, height: H, position: 'relative' }}
          onLayout={e => setPlotW(e.nativeEvent.layout.width)}
        >
          {plotW > 0 && (
            <>
              {/* Líneas p50 / p85 (verticales) */}
              <View style={[sc.vLine, { left: (p50 / maxDays) * plotW, borderColor: Colors.primary + '60' }]} />
              <View style={[sc.vLine, { left: (p85 / maxDays) * plotW, borderColor: Colors.warning + '60' }]} />
              {/* Puntos */}
              {pts.map((p, i) => (
                <View
                  key={i}
                  style={[sc.dot, {
                    left: Math.min((p.days / maxDays) * plotW, plotW - 6),
                    top: topFor(p.ts),
                    backgroundColor: p.days > p85 ? Colors.error : p.days > p50 ? Colors.warning : Colors.success,
                  }]}
                />
              ))}
              {/* Etiquetas p50/p85 arriba de sus líneas */}
              <Text style={[sc.vLabel, { left: (p50 / maxDays) * plotW }]}>p50 {p50.toFixed(1)}d</Text>
              <Text style={[sc.vLabel, { left: (p85 / maxDays) * plotW }]}>p85 {p85.toFixed(1)}d</Text>
            </>
          )}
        </View>
      </View>
      {/* Eje de cycle time (horizontal, días) */}
      <View style={sc.xRow}>
        <Text style={sc.xLabel}>0d</Text>
        <Text style={sc.xLabel}>{(maxDays / 2).toFixed(0)}d</Text>
        <Text style={sc.xLabel}>{maxDays.toFixed(0)}d</Text>
      </View>
    </View>
  );
}

const sc = StyleSheet.create({
  vLine: { position: 'absolute', top: 0, bottom: 0, width: 1, borderLeftWidth: 1, borderStyle: 'dashed' },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, opacity: 0.85 },
  tLabel: { position: 'absolute', right: 4, fontSize: 9, color: Colors.textSubtle },
  vLabel: { position: 'absolute', top: 0, fontSize: 9, color: Colors.textMuted },
  xRow: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 46, marginTop: 4 },
  xLabel: { fontSize: 9, color: Colors.textSubtle },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AnalisisScreen() {
  const { bottleneck, forecast, cfd, issues, hasData } = useAnalysis();
  const timeRange = useFilterStore(s => s.timeRange);
  const range = dateRangeFor(timeRange);

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
          <CycleTimeScatter issues={issues} range={range} />
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
