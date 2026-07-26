import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Card, Typography } from '../../lib/theme';
import { KPICard } from '../../components/KPICard';
import { ComparisonWidget } from '../../components/ComparisonWidget';
import { EmptyState } from '../../components/EmptyState';
import { useKPIs } from '../../hooks/useKPIs';

const TALLA_COLOR: Record<string, string> = {
  S: '#86efac', M: '#93c5fd', L: '#c4b5fd', XL: '#fca5a5',
};

function formatDays(days: number | null): string {
  if (days === null) return '—';
  return days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`;
}

const TALLA_ORDER: Array<keyof typeof TALLA_COLOR> = ['S', 'M', 'L', 'XL'];

function fmtWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function ThroughputBars({ data }: { data: { week: string; count: number; by_talla: Record<string, number> }[] }) {
  const BAR_H = 90;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <View style={{ height: BAR_H + 36, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {data.map((d, i) => {
        const barH = Math.max((d.count / max) * BAR_H, d.count > 0 ? 3 : 0);
        const tallaTotal = TALLA_ORDER.reduce((s, t) => s + (d.by_talla[t] ?? 0), 0);
        return (
          <View key={i} style={b.barCol}>
            <View style={b.barLabelRow}>
              {d.count > 0 && <Text style={b.barCount}>{d.count}</Text>}
            </View>
            <View style={[b.barWrap, { height: barH }]}>
              {TALLA_ORDER.map(t => {
                const n = d.by_talla[t] ?? 0;
                if (n === 0) return null;
                const segH = tallaTotal > 0 ? (n / Math.max(tallaTotal, d.count)) * barH : 0;
                return (
                  <View
                    key={t}
                    style={{ width: '100%', height: segH, backgroundColor: TALLA_COLOR[t] }}
                  />
                );
              })}
            </View>
            <Text style={b.barWeek} numberOfLines={2}>{fmtWeek(d.week)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const b = StyleSheet.create({
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barLabelRow: { height: 16, justifyContent: 'flex-end' },
  barWrap: { width: '75%', overflow: 'hidden', borderRadius: 3, justifyContent: 'flex-end' },
  barCount: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },
  barWeek: { fontSize: 11, color: Colors.textMuted, marginTop: 4, textAlign: 'center', lineHeight: 14 },
});

function CycleTimeTalla({ ctByTalla }: { ctByTalla: Record<string, number | null> }) {
  const TALLAS = ['S', 'M', 'L', 'XL'];
  const LABELS: Record<string, string> = { S: 'Simple', M: 'Moderado', L: 'Complejo', XL: 'Muy complejo' };
  return (
    <View style={ct.row}>
      {TALLAS.map(t => {
        const color = TALLA_COLOR[t];
        const val = ctByTalla[t] ?? null;
        return (
          <View key={t} style={[ct.card, { borderColor: color + '40' }]}>
            <View style={[ct.badge, { backgroundColor: color + '25' }]}>
              <Text style={[ct.badgeText, { color }]}>{t}</Text>
            </View>
            <Text style={[ct.value, { color }]}>{formatDays(val)}</Text>
            <Text style={ct.label} numberOfLines={1}>{LABELS[t]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const ct = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  card: {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: 10,
    borderWidth: 1, padding: 10, alignItems: 'center', gap: 6,
  },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 13, fontWeight: '800' },
  value: { fontSize: 17, fontWeight: '700' },
  label: { fontSize: 11, color: Colors.textSubtle, textAlign: 'center' },
});

function WeekSelector({ weeks, selected, onSelect }: {
  weeks: string[];
  selected: string | undefined;
  onSelect: (w: string | undefined) => void;
}) {
  if (weeks.length === 0) return null;

  function formatWeek(monday: string): string {
    const [y, m, d] = monday.split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    return mon.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={w.scroll} contentContainerStyle={w.content}>
      <TouchableOpacity
        style={[w.chip, selected === undefined && w.chipActive]}
        onPress={() => onSelect(undefined)}
      >
        <Text style={[w.chipText, selected === undefined && w.chipTextActive]}>Esta semana</Text>
      </TouchableOpacity>
      {weeks.slice(1).map(week => (
        <TouchableOpacity
          key={week}
          style={[w.chip, selected === week && w.chipActive]}
          onPress={() => onSelect(week)}
        >
          <Text style={[w.chipText, selected === week && w.chipTextActive]}>{formatWeek(week)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const w = StyleSheet.create({
  scroll: { marginHorizontal: -16, marginBottom: -4 },
  content: { paddingHorizontal: 16, gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textMuted },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});

export default function InicioScreen() {
  const [selectedWeek, setSelectedWeek] = useState<string | undefined>(undefined);
  const { kpi, throughput, comparison, availableWeeks, ctByTalla, hasData } = useKPIs(selectedWeek);

  if (!hasData) return <EmptyState />;

  const chartData = throughput.map(w => ({
    week: w.week,
    count: w.count,
    by_talla: w.by_talla,
  }));

  const hasCT = Object.values(ctByTalla).some(v => v !== null);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* KPIs */}
      <View style={s.kpiGrid}>
        <KPICard label="WIP" value={kpi?.wip ?? null} sub="issues en curso" />
        <KPICard label="Throughput" value={kpi?.throughput ?? null} sub="issues completados" />
        <KPICard
          label="Cycle P50"
          value={kpi?.cycle_time_p50 != null ? `${kpi.cycle_time_p50.toFixed(2)}d` : null}
          sub="tiempo mediano"
        />
        <KPICard
          label="Bloqueados"
          value={kpi?.blocked_count ?? null}
          sub="issues bloqueados"
          color={kpi && kpi.blocked_count > 0 ? Colors.error : Colors.text}
        />
      </View>

      {/* Cycle time by talla */}
      {hasCT && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cycle Time por talla</Text>
          <CycleTimeTalla ctByTalla={ctByTalla} />
        </>
      )}

      {/* Week selector + Comparison */}
      {availableWeeks.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Comparativa semanal</Text>
          <WeekSelector weeks={availableWeeks} selected={selectedWeek} onSelect={setSelectedWeek} />
          {comparison && <ComparisonWidget result={comparison} />}
        </>
      )}

      {/* Throughput chart */}
      {chartData.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Throughput semanal</Text>
          <View style={[Card.base, s.chartCard]}>
            <ThroughputBars data={chartData} />
          </View>
        </>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { marginTop: 2, fontSize: 12 },
  chartCard: { paddingBottom: 12 },
});
