import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Card, Typography } from '../../lib/theme';
import { BASE_URL_KEY, DEFAULT_BASE_URL, setBaseUrl } from '../../lib/api';
import { useSyncStore } from '../../store/syncStore';
import { useFilterStore } from '../../store/filterStore';

const TALLA_OPTIONS = ['S', 'M', 'L', 'XL'] as const;

export default function AjustesScreen() {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const { sync, loading, lastSyncedAt } = useSyncStore();
  const { assignee, talla, setAssignee, setTalla } = useFilterStore();

  useEffect(() => {
    AsyncStorage.getItem(BASE_URL_KEY).then(v => { if (v) setUrl(v); });
  }, []);

  const handleUrlBlur = () => setBaseUrl(url);

  const handleSync = async () => {
    await sync();
    const currentErrors = useSyncStore.getState().errors;
    if (currentErrors.length > 0) {
      Alert.alert('Sync parcial', `${currentErrors.length} endpoint(s) fallaron:\n${currentErrors.map(e => e.endpoint).join('\n')}`);
    }
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
        <Text style={[Typography.label, { marginBottom: 6 }]}>Persona</Text>
        <TouchableOpacity
          style={s.selectBox}
          onPress={() => setAssignee(assignee ? null : 'me')}
        >
          <Text style={s.selectText}>{assignee ?? 'Todos'}</Text>
          <Feather name="chevron-down" size={14} color={Colors.textSubtle} />
        </TouchableOpacity>

        <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>Talla</Text>
        <View style={s.tallaRow}>
          {([null, ...TALLA_OPTIONS] as const).map(t => (
            <TouchableOpacity
              key={String(t)}
              style={[s.tallaChip, talla === t && s.tallaChipActive]}
              onPress={() => setTalla(t)}
            >
              <Text style={[s.tallaText, talla === t && s.tallaTextActive]}>
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
    color: Colors.primaryLight, fontFamily: 'monospace', fontSize: 12,
  },
  hint: { fontSize: 11, color: Colors.textSubtle, marginTop: 6 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  syncDate: { fontSize: 12, color: Colors.textSubtle, marginTop: 2 },
  syncButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  syncButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  selectText: { fontSize: 12, color: Colors.text },
  tallaRow: { flexDirection: 'row', gap: 8 },
  tallaChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
  },
  tallaChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tallaText: { fontSize: 12, color: Colors.textMuted },
  tallaTextActive: { color: '#fff', fontWeight: '600' },
});
