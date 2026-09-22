import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useFilterStore, type TimeRange } from '../store/filterStore';
import { useSyncStore } from '../store/syncStore';
import { getDb, loadMembersByIssueCount } from '../lib/db';
import { personFilterLabel, type MemberOption } from '../lib/personFilter';
import { PersonFilterSheet } from './PersonFilterSheet';

const RANGES: { label: string; value: TimeRange }[] = [
  { label: '30d', value: '30d' },
  { label: '60d', value: '60d' },
  { label: '90d', value: '90d' },
  { label: '180d', value: '180d' },
  { label: '360d', value: '360d' },
];

export function DateRangeBar() {
  const { timeRange, setTimeRange, assignees } = useFilterStore();
  const { recompute, loading, dataVersion } = useSyncStore();
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);

  // Ordenados por cantidad de issues, NO alfabeticamente: de 40 miembros solo ~12
  // tienen actividad real (el resto entre 0 y 9 issues), asi que el orden por nombre
  // entierra a los relevantes. El selector muestra los primeros y busca sobre todos.
  //
  // La lista sale de `team_members` (el crudo) y NO de `readTeamMemberNames`, que lee
  // `scorecard_members`: esa tabla la reescribe `recomputeSnapshots` YA FILTRADA, asi
  // que leerla aca se autoamputa -elegis a una persona y el picker solo la ofrece a
  // ella- y ademas ya paso por `hasAllData`, que excluye a quien no tiene datos.
  //
  // Depende de `dataVersion` para recargarse tras cada sync: en una instalacion nueva
  // la tabla arranca vacia y el sheet quedaria vacio hasta remontar la solapa.
  useEffect(() => {
    getDb()
      .then(db => loadMembersByIssueCount(db))
      .then(rows => setMembers(rows.map(m => ({
        id: m.id,
        name: m.display_name,
        issueCount: m.issue_count,
      }))))
      .catch(console.error);
  }, [dataVersion]);

  const handleSelect = (range: TimeRange) => {
    if (range === timeRange) return;
    setTimeRange(range);
    recompute();     // local, sin ida al server
  };

  return (
    <View>
      {/* Una sola fila: los chips de rango y el selector de personas juntos. En dos
          filas la barra comia ~40pt extra de alto en cada pantalla y dejaba un borde
          doble entre medio. Los chips no se encogen (`flexShrink: 0`) y el selector
          toma lo que sobra con `flex: 1`, truncando el nombre si hace falta. */}
      <View style={s.row}>
        {RANGES.map(r => (
          <TouchableOpacity
            key={r.value}
            style={[s.chip, r.value === timeRange && s.chipActive]}
            onPress={() => handleSelect(r.value)}
            disabled={loading}
          >
            <Text style={[s.chipText, r.value === timeRange && s.chipTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[s.personBtn, assignees.length > 0 && s.personBtnActive]}
          onPress={() => setSheetVisible(true)}
        >
          <Feather
            name="users"
            size={12}
            color={assignees.length > 0 ? '#fff' : Colors.textMuted}
          />
          <Text
            style={[s.personText, assignees.length > 0 && s.personTextActive]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {personFilterLabel(assignees, members)}
          </Text>
        </TouchableOpacity>
      </View>

      <PersonFilterSheet
        visible={sheetVisible}
        members={members}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  chip: {
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: 13, color: Colors.textMuted },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  personBtn: {
    // `flex: 1` + `minWidth: 0` para que el nombre largo trunque en vez de empujar
    // los chips fuera de la pantalla.
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  personBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  personText: { flexShrink: 1, fontSize: 12, color: Colors.textMuted },
  personTextActive: { color: '#fff', fontWeight: '600' },
});
