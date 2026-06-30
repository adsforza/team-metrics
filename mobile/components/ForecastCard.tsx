import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { CartesianChart, Bar } from 'victory-native';
import { Colors, Card } from '../lib/theme';
import type { ForecastBin, ForecastResult } from '../lib/types';

// Thin wrapper that accepts typed bins but passes `any` to CartesianChart
// to work around its strict Record<string,unknown> generic constraint.
function HistogramChart({ data }: { data: ForecastBin[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyData = data as any[];
  return (
    <View style={s.chart}>
      <CartesianChart
        data={anyData}
        xKey="x"
        yKeys={['count']}
        domainPadding={{ left: 8, right: 8, top: 12 }}
      >
        {({ points, chartBounds }: any) => (
          <Bar
            points={points.count}
            chartBounds={chartBounds}
            color={Colors.primary}
            roundedCorners={{ topLeft: 2, topRight: 2 }}
          />
        )}
      </CartesianChart>
    </View>
  );
}

export function ForecastCard({ forecast }: { forecast: ForecastResult }) {
  const [mode, setMode] = useState<'when' | 'howMany'>('when');

  if (forecast.insufficientData) {
    return (
      <View style={[Card.base, s.empty]}>
        <Text style={s.emptyText}>Datos insuficientes para forecast</Text>
      </View>
    );
  }

  const data = mode === 'when'
    ? forecast.when?.histogram ?? []
    : forecast.howMany?.histogram ?? [];

  return (
    <View style={Card.base}>
      <View style={s.toggle}>
        {(['when', 'howMany'] as const).map(m => (
          <TouchableOpacity
            key={m}
            style={[s.toggleBtn, mode === m && s.toggleBtnActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
              {m === 'when' ? '¿Cuándo?' : '¿Cuántos?'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Percentiles */}
      {mode === 'when' && forecast.when && (
        <View style={s.percRow}>
          {[
            { label: 'P50', val: `${forecast.when.conf50.days}d`, color: Colors.success },
            { label: 'P85', val: `${forecast.when.conf85.days}d`, color: Colors.warning },
            { label: 'P95', val: `${forecast.when.conf95.days}d`, color: Colors.error },
          ].map(p => (
            <View key={p.label} style={s.perc}>
              <Text style={s.percLabel}>{p.label}</Text>
              <Text style={[s.percValue, { color: p.color }]}>{p.val}</Text>
            </View>
          ))}
        </View>
      )}
      {mode === 'howMany' && forecast.howMany && (
        <View style={s.percRow}>
          {[
            { label: 'P50', val: String(forecast.howMany.conf50), color: Colors.success },
            { label: 'P85', val: String(forecast.howMany.conf85), color: Colors.warning },
            { label: 'P95', val: String(forecast.howMany.conf95), color: Colors.error },
          ].map(p => (
            <View key={p.label} style={s.perc}>
              <Text style={s.percLabel}>{p.label}</Text>
              <Text style={[s.percValue, { color: p.color }]}>{p.val}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Histogram */}
      {data.length > 0 && (
        <HistogramChart data={data} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  toggle: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: 11, color: Colors.textMuted },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  percRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  perc: { flex: 1, backgroundColor: Colors.bg, borderRadius: 8, padding: 8, alignItems: 'center' },
  percLabel: { fontSize: 9, color: Colors.textSubtle, marginBottom: 4 },
  percValue: { fontSize: 18, fontWeight: '700' },
  chart: { height: 120 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 12, color: Colors.textSubtle },
});
