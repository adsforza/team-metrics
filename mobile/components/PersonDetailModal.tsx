import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import type { PersonScorecard, DimensionValue, TeamScorecardResponse } from '../lib/types';

type Ctx = TeamScorecardResponse['context'];
type DimKey = keyof Ctx;

interface ColDef {
  key: DimKey;
  label: string;
  hint: string;
  format: (v: number) => string;
  aboveIsGood: boolean;
}

const COLS: ColDef[] = [
  { key: 'delivery',       label: 'Entrega',        hint: 'issues terminados en el período',                  format: v => `${Math.round(v)}`,   aboveIsGood: true  },
  { key: 'predictability', label: 'Predecibilidad', hint: 'ratio P85/P50 del cycle time (1 = ideal)',         format: v => v.toFixed(1),          aboveIsGood: false },
  { key: 'focus',          label: 'Foco',           hint: 'WIP paralelo promedio (menos es mejor)',           format: v => v.toFixed(1),          aboveIsGood: false },
  { key: 'flow',           label: 'Flujo',          hint: '% issues completados sin interrupciones',          format: v => `${Math.round(v)}%`,   aboveIsGood: true  },
  { key: 'regressions',    label: 'Regresiones',    hint: '% issues que retrocedieron en el flujo de estados', format: v => `${Math.round(v)}%`, aboveIsGood: false },
  { key: 'blocked',        label: 'Bloqueados',     hint: '% issues que pasaron por estado Bloqueado',        format: v => `${Math.round(v)}%`,   aboveIsGood: false },
];

function generateComment(col: ColDef, dim: DimensionValue, ctx: Ctx): string {
  if (dim.value === null) return 'Sin datos suficientes para este período.';

  const val = dim.value;
  const median = ctx[col.key]?.median;
  const parts: string[] = [];

  if (median != null && median > 0) {
    const diffPct = Math.round(Math.abs(((val - median) / median) * 100));
    if (diffPct <= 8) {
      parts.push(`En línea con la media del equipo (${col.format(median)}).`);
    } else {
      const isAbove = val > median;
      const dir = isAbove ? 'encima' : 'debajo';
      const isGood = isAbove === col.aboveIsGood;
      const qualifier = isGood ? 'positivo' : 'a mejorar';
      parts.push(`${diffPct}% ${dir} de la media del equipo (${col.format(median)}) — ${qualifier}.`);
    }
  }

  if (dim.previous !== null) {
    if (dim.improving === 'better') {
      parts.push(`Mejora desde el período anterior (${col.format(dim.previous)}).`);
    } else if (dim.improving === 'worse') {
      parts.push(`Retroceso desde el período anterior (${col.format(dim.previous)}).`);
    } else {
      parts.push(`Estable respecto al período anterior (${col.format(dim.previous)}).`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : `Valor: ${col.format(val)}.`;
}

function generateTasks(p: PersonScorecard): string[] {
  const tasks: string[] = [];
  if (p.delivery.improving === 'worse')
    tasks.push('Throughput bajando respecto al período anterior — revisar capacity o impedimentos');
  if (p.predictability.value !== null && p.predictability.value > 2.5)
    tasks.push(`Cycle time muy variable (ratio ${p.predictability.value.toFixed(1)}) — considerar dividir issues L/XL`);
  else if (p.predictability.improving === 'worse')
    tasks.push('Predecibilidad empeorando — el spread del cycle time está aumentando');
  if (p.focus.value !== null && p.focus.value > 3)
    tasks.push(`WIP elevado: ${p.focus.value.toFixed(1)} issues en paralelo — cerrar antes de abrir nuevos`);
  if (p.regressions.value !== null && p.regressions.value > 15)
    tasks.push(`${Math.round(p.regressions.value)}% de issues retrocedieron — revisar criterios de Ready/Done`);
  if (p.blocked.value !== null && p.blocked.value > 20)
    tasks.push(`${Math.round(p.blocked.value)}% de issues bloqueados — identificar dependencias`);
  return tasks;
}

function MetricCard({ col, dim, ctx }: { col: ColDef; dim: DimensionValue; ctx: Ctx }) {
  const arrow = dim.trend === 'up' ? '↑' : dim.trend === 'down' ? '↓' : '→';
  const arrowColor = dim.improving === 'better' ? Colors.success
    : dim.improving === 'worse' ? Colors.error : Colors.warning;
  const comment = generateComment(col, dim, ctx);

  return (
    <View style={s.metricCard}>
      <Text style={s.metricLabel}>{col.label}</Text>
      <Text style={s.metricHint}>{col.hint}</Text>
      <View style={s.metricValueRow}>
        <Text style={s.metricValue}>{dim.value !== null ? col.format(dim.value) : '—'}</Text>
        <Text style={[s.metricArrow, { color: arrowColor }]}>{arrow}</Text>
      </View>
      <Text style={s.metricComment}>{comment}</Text>
    </View>
  );
}

interface Props {
  person: PersonScorecard | null;
  ctx: Ctx;
  onClose: () => void;
}

export function PersonDetailModal({ person, ctx, onClose }: Props) {
  if (!person) return null;
  const tasks = generateTasks(person);
  const initials = person.member.display_name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <Text style={s.name}>{person.member.display_name}</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          <View style={s.grid}>
            {COLS.map(col => (
              <MetricCard key={col.key} col={col} dim={person[col.key]} ctx={ctx} />
            ))}
          </View>

          <View style={s.tasksSection}>
            <Text style={s.tasksSectionTitle}>
              {tasks.length > 0 ? '⚠ Prestar atención' : '✓ Sin alertas'}
            </Text>
            {tasks.length > 0 ? (
              tasks.map((t, i) => (
                <View key={i} style={s.taskItem}>
                  <Text style={s.taskBullet}>•</Text>
                  <Text style={s.taskText}>{t}</Text>
                </View>
              ))
            ) : (
              <Text style={s.noTasksText}>Todo en orden para este período.</Text>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1e40af', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#bfdbfe' },
  name: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text },
  closeBtn: { padding: 6 },
  closeBtnText: { fontSize: 18, color: Colors.textMuted },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: {
    width: '47%', backgroundColor: Colors.bgCard,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14,
    gap: 4,
  },
  metricLabel: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricHint: { fontSize: 10, color: Colors.textSubtle, lineHeight: 14, marginTop: -2 },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  metricValue: { fontSize: 26, fontWeight: '700', color: Colors.text },
  metricArrow: { fontSize: 17, fontWeight: '700' },
  metricComment: { fontSize: 13, color: Colors.textMuted, lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  tasksSection: {
    backgroundColor: Colors.bgCard, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  tasksSectionTitle: {
    fontSize: 13, fontWeight: '700', textTransform: 'uppercase',
    color: Colors.warning, marginBottom: 12, letterSpacing: 0.5,
  },
  taskItem: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  taskBullet: { fontSize: 15, color: Colors.warning, lineHeight: 21 },
  taskText: { flex: 1, fontSize: 14, color: Colors.warning, lineHeight: 21 },
  noTasksText: { fontSize: 14, color: Colors.success },
});
