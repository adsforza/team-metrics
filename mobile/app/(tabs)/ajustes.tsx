import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Card, Typography } from '../../lib/theme';
import { BASE_URL_KEY, DEFAULT_BASE_URL, setBaseUrl } from '../../lib/api';
import { useSyncStore } from '../../store/syncStore';
import { useFilterStore } from '../../store/filterStore';
import { getDb, readTeamMemberNames } from '../../lib/db';

const TALLA_OPTIONS = ['S', 'M', 'L', 'XL'] as const;

export default function AjustesScreen() {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const { sync, loading, lastSyncedAt } = useSyncStore();
  const { assignee, talla, setAssignee, setTalla } = useFilterStore();

  const handleSetAssignee = (id: string | null) => {
    setAssignee(id);
    sync();
  };
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(BASE_URL_KEY).then(v => { if (v) setUrl(v); });
    getDb().then(db => readTeamMemberNames(db)).then(setMembers).catch(console.error);
  }, []);

  const handleUrlBlur = () => setBaseUrl(url);

  const handleSync = async () => {
    await sync();
    const currentErrors = useSyncStore.getState().errors;
    if (currentErrors.length > 0) {
      Alert.alert('Sync parcial', `${currentErrors.length} endpoint(s) fallaron:\n${currentErrors.map(e => e.endpoint).join('\n')}`);
    }
    // Reload members after sync
    getDb().then(db => readTeamMemberNames(db)).then(setMembers).catch(console.error);
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* Servidor */}
      <Text style={[Typography.label, s.sectionLabel]}>Servidor</Text>
      <View style={Card.base}>
        <Text style={[Typography.label, { marginBottom: 6 }]}>URL base</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          onBlur={handleUrlBlur}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_BASE_URL}
          placeholderTextColor={Colors.textSubtle}
        />
        <Text style={s.hint}>Cambiá la URL para conectar a un servidor con IP pública.</Text>
      </View>

      {/* Sincronización */}
      <Text style={[Typography.label, s.sectionLabel]}>Sincronización</Text>
      <View style={Card.base}>
        <View style={s.syncRow}>
          <View>
            <Text style={Typography.bodyMuted}>Última sync</Text>
            <Text style={s.syncDate}>
              {lastSyncedAt ? fmtDate(lastSyncedAt) : 'Nunca sincronizado'}
            </Text>
          </View>
          <TouchableOpacity style={s.syncButton} onPress={handleSync} disabled={loading}>
            <Feather name="refresh-cw" size={13} color="#fff" />
            <Text style={s.syncButtonText}>{loading ? 'Sincronizando…' : 'Sincronizar'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filtros globales */}
      <Text style={[Typography.label, s.sectionLabel]}>Filtros globales</Text>
      <View style={Card.base}>
        <Text style={[Typography.label, { marginBottom: 10 }]}>Persona</Text>
        <View style={s.chipRow}>
          <TouchableOpacity
            style={[s.chip, assignee === null && s.chipActive]}
            onPress={() => handleSetAssignee(null)}
          >
            <Text style={[s.chipText, assignee === null && s.chipTextActive]}>Todos</Text>
          </TouchableOpacity>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[s.chip, assignee === m.id && s.chipActive]}
              onPress={() => handleSetAssignee(assignee === m.id ? null : m.id)}
            >
              <Text style={[s.chipText, assignee === m.id && s.chipTextActive]} numberOfLines={1}>
                {m.name.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {members.length === 0 && (
          <Text style={s.hint}>Sincronizá para ver el listado de personas.</Text>
        )}

        <Text style={[Typography.label, { marginBottom: 10, marginTop: 16 }]}>Talla</Text>
        <View style={s.chipRow}>
          {([null, ...TALLA_OPTIONS] as const).map(t => (
            <TouchableOpacity
              key={String(t)}
              style={[s.chip, talla === t && s.chipActive]}
              onPress={() => setTalla(t)}
            >
              <Text style={[s.chipText, talla === t && s.chipTextActive]}>
                {t ?? 'Todas'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 8 },
  sectionLabel: { marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: Colors.primaryLight, fontFamily: 'monospace', fontSize: 13,
  },
  hint: { fontSize: 13, color: Colors.textSubtle, marginTop: 6 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  syncDate: { fontSize: 13, color: Colors.textSubtle, marginTop: 2 },
  syncButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  syncButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textMuted },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
