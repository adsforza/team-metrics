import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';
import { Colors, Card } from '../lib/theme';
import type { ForecastBin, ForecastResult } from '../lib/types';

function HistogramBars({ data }: { data: ForecastBin[] }) {
  if (data.length === 0) return null;
  const BAR_H = 60;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <View style={h.wrap}>
      {data.map((d, i) => (
        <View key={i} style={h.col}>
          <View
            style={[
              h.bar,
              {
                height: Math.max((d.count / max) * BAR_H, d.count > 0 ? 2 : 0),
                backgroundColor: Colors.primary,
                opacity: 0.5 + 0.5 * (d.count / max),
              },
            ]}
          />
          {(i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) && (
            <Text style={h.label}>{d.x}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const h = StyleSheet.create({
  wrap: { height: 80, flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 12 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '80%', borderRadius: 2 },
  label: { fontSize: 9, color: Colors.textSubtle, marginTop: 2 },
});

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
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
      <Text style={s.context}>{forecast.items} issues en curso · {forecast.lookbackDays}d de historial</Text>

      <View style={s.toggle}>
        {(['when', 'howMany'] as const).map(m => (
          <TouchableOpacity
            key={m}
            style={[s.toggleBtn, mode === m && s.toggleBtnActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
              {m === 'when' ? '¿Cuándo termina?' : '¿Cuántos por sprint?'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'when' && forecast.when && (
        <View style={s.percRow}>
          {[
            { label: 'Optimista',   pct: '50%', days: forecast.when.conf50.days, date: forecast.when.conf50.date, color: Colors.warning },
            { label: 'Recomendado', pct: '85%', days: forecast.when.conf85.days, date: forecast.when.conf85.date, color: Colors.primary },
            { label: 'Conservador', pct: '95%', days: forecast.when.conf95.days, date: forecast.when.conf95.date, color: Colors.success },
          ].map(p => (
            <View key={p.label} style={[s.perc, { borderColor: p.color + '40' }]}>
              <Text style={[s.percLabel, { color: p.color }]}>{p.label}</Text>
              <Text style={[s.percDays, { color: p.color }]}>{p.days}d</Text>
              <Text style={[s.percSub, { color: p.color }]}>{fmtDate(p.date)}</Text>
              <Text style={s.percPct}>{p.pct} prob.</Text>
            </View>
          ))}
        </View>
      )}

      {mode === 'howMany' && forecast.howMany && (
        <>
          <Text style={s.horizonBadge}>en {forecast.horizonDays} días</Text>
          <View style={s.percRow}>
            {[
              { label: 'Optimista',   pct: '50%', val: forecast.howMany.conf50, color: Colors.warning },
              { label: 'Recomendado', pct: '85%', val: forecast.howMany.conf85, color: Colors.primary },
              { label: 'Conservador', pct: '95%', val: forecast.howMany.conf95, color: Colors.success },
            ].map(p => (
              <View key={p.label} style={[s.perc, { borderColor: p.color + '40' }]}>
                <Text style={[s.percLabel, { color: p.color }]}>{p.label}</Text>
                <Text style={[s.percDays, { color: p.color }]}>≥ {p.val}</Text>
                <Text style={[s.percSub, { color: p.color }]}>issues</Text>
                <Text style={s.percPct}>{p.pct} prob.</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <HistogramBars data={data} />
    </View>
  );
}

const s = StyleSheet.create({
  context: { fontSize: 12, color: Colors.textMuted, marginBottom: 12 },
  toggle: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: 13, color: Colors.textMuted },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  percRow: { flexDirection: 'row', gap: 8 },
  perc: { flex: 1, backgroundColor: Colors.bg, borderRadius: 10, borderWidth: 1, padding: 10, alignItems: 'center', gap: 2 },
  percLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  percDays: { fontSize: 22, fontWeight: '700', lineHeight: 28, color: Colors.text },
  percSub: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  horizonBadge: {
    alignSelf: 'center',
    fontSize: 12, fontWeight: '600', color: Colors.textMuted,
    backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3,
    marginBottom: 10,
  },
  percPct: { fontSize: 11, color: Colors.textSubtle, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 13, color: Colors.textSubtle },
});
