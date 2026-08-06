import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Card, Typography } from '../../lib/theme';
import { BASE_URL_KEY, DEFAULT_BASE_URL, setBaseUrl } from '../../lib/api';
import { useSyncStore } from '../../store/syncStore';
import { useFilterStore } from '../../store/filterStore';
import { getDb, readTeamMemberNames } from '../../lib/db';
import { getDirectConfigFields, setDirectConfigFields, getDirectConfig, type DirectConfigFields } from '../../lib/directConfig';
import { jiraHttpFetch } from '../../lib/transports';

const TALLA_OPTIONS = ['S', 'M', 'L', 'XL'] as const;

export default function AjustesScreen() {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const [dc, setDc] = useState<Partial<DirectConfigFields>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const { sync, reclassify, loading, lastSyncedAt, progress } = useSyncStore();
  const { assignee, talla, setAssignee, setTalla } = useFilterStore();

  const handleSetAssignee = (id: string | null) => {
    setAssignee(id);
    sync();
  };
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(BASE_URL_KEY).then(v => { if (v) setUrl(v); });
    getDb().then(db => readTeamMemberNames(db)).then(setMembers).catch(console.error);
    getDirectConfigFields().then(setDc).catch(console.error);
  }, []);

  const handleUrlBlur = () => setBaseUrl(url);

  const handleSync = async () => {
    await sync();
    const currentErrors = useSyncStore.getState().errors;
    if (currentErrors.length > 0) {
      Alert.alert('Sync parcial', `${currentErrors.length} endpoint(s) fallaron:\n${currentErrors.map(e => `${e.endpoint}: ${e.message}`).join('\n\n')}`);
    }
    // Reload members after sync
    getDb().then(db => readTeamMemberNames(db)).then(setMembers).catch(console.error);
  };

  // Prueba aislada de auth contra Jira usando las credenciales GUARDADAS (no las del
  // input), replicando el path del sync. Muestra longitud del token + email para
  // detectar pegados truncados o email equivocado sin exponer el secreto.
  const handleTestDirect = async () => {
    const cfg = await getDirectConfig();
    if (!cfg) {
      Alert.alert('Jira directo', 'Faltan campos en la config. Completá todo y Guardá primero.');
      return;
    }
    const b = cfg.boards[0];
    const meta =
      `\n\nToken guardado: ${b.apiToken.length} chars` +
      `\nEmail: ${b.email}` +
      `\nBoard: ${b.boardId}`;
    try {
      const me = await jiraHttpFetch({
        url: `${b.baseUrl}/rest/api/3/myself`,
        auth: { username: b.email, password: b.apiToken },
        params: {},
      }) as { displayName?: string };
      Alert.alert('Jira OK ✅', `Autenticado como ${me.displayName ?? '(sin nombre)'}${meta}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Jira falló ❌', `${msg}${meta}`);
    }
  };

  const handleReclassify = async () => {
    const r = await reclassify();
    if (r.mode === 'backend') {
      Alert.alert('Reclasificación iniciada', `El server está clasificando ${r.pending} issue(s) en segundo plano (limitado por la cuota de Gemini). Volvé a sincronizar en un rato para ver los resultados.`);
    } else if (r.mode === 'direct') {
      const errs = useSyncStore.getState().errors;
      Alert.alert(
        'Reclasificación (directo)',
        `${r.classified} issue(s) clasificado(s).` +
          (errs.length ? `\n${errs.length} lote(s) fallaron — probablemente cuota de Gemini agotada; reintentá más tarde.` : ''),
      );
    } else {
      Alert.alert('Reclasificar', 'No hay backend disponible ni config de "Jira directo" completa.');
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

      {/* Jira directo */}
      <Text style={[Typography.label, s.sectionLabel]}>Jira directo (modo sin backend)</Text>
      <View style={Card.base}>
        <Text style={[Typography.label, { marginBottom: 6 }]}>URL base</Text>
        <TextInput
          style={s.input}
          value={dc.baseUrl ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, baseUrl: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://jira.example.com"
          placeholderTextColor={Colors.textSubtle}
        />

        <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>Email</Text>
        <TextInput
          style={s.input}
          value={dc.email ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, email: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="tu@email.com"
          placeholderTextColor={Colors.textSubtle}
        />

        <View style={s.labelRow}>
          <Text style={Typography.label}>API Token{dc.apiToken ? `  (${dc.apiToken.length} chars)` : ''}</Text>
          <TouchableOpacity onPress={() => setShowSecrets(v => !v)} hitSlop={8}>
            <Feather name={showSecrets ? 'eye-off' : 'eye'} size={15} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={s.input}
          value={dc.apiToken ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, apiToken: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textContentType="none"
          autoComplete="off"
          secureTextEntry={!showSecrets}
          placeholder="pegá el token completo (192 chars)"
          placeholderTextColor={Colors.textSubtle}
        />

        <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>Project Key</Text>
        <TextInput
          style={s.input}
          value={dc.projectKey ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, projectKey: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="PROJ"
          placeholderTextColor={Colors.textSubtle}
        />

        <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>Board IDs</Text>
        <TextInput
          style={s.input}
          value={dc.boardIds ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, boardIds: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="7,9"
          placeholderTextColor={Colors.textSubtle}
        />

        <View style={s.labelRow}>
          <Text style={Typography.label}>Gemini API Key{dc.geminiKey ? `  (${dc.geminiKey.length} chars)` : ''}</Text>
          <TouchableOpacity onPress={() => setShowSecrets(v => !v)} hitSlop={8}>
            <Feather name={showSecrets ? 'eye-off' : 'eye'} size={15} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={s.input}
          value={dc.geminiKey ?? ''}
          onChangeText={t => setDc(prev => ({ ...prev, geminiKey: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textContentType="none"
          autoComplete="off"
          secureTextEntry={!showSecrets}
          placeholder="pegá la API key"
          placeholderTextColor={Colors.textSubtle}
        />

        <View style={[s.syncRow, { marginTop: 14 }]}>
          <TouchableOpacity
            style={s.reclassifyButton}
            onPress={handleTestDirect}
          >
            <Feather name="wifi" size={13} color={Colors.primary} />
            <Text style={s.reclassifyButtonText}>Probar conexión</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.syncButton}
            onPress={async () => {
              await setDirectConfigFields(dc);
              setDc(await getDirectConfigFields());
              Alert.alert('Guardado', 'Config del modo directo guardada');
            }}
          >
            <Feather name="save" size={13} color="#fff" />
            <Text style={s.syncButtonText}>Guardar</Text>
          </TouchableOpacity>
        </View>
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
        <TouchableOpacity
          style={[s.reclassifyButton, { marginTop: 12 }]}
          onPress={handleReclassify}
          disabled={loading}
        >
          <Feather name="tag" size={13} color={Colors.primary} />
          <Text style={s.reclassifyButtonText}>{loading ? 'Procesando…' : 'Reclasificar tallas'}</Text>
        </TouchableOpacity>
        <Text style={s.hint}>
          Clasifica los issues sin talla. Con el server disponible lo hace el backend; si no, directo con Gemini (limitado por cuota).
        </Text>
        {loading && progress && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.hint}>{progress.label}</Text>
            {progress.total ? (
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${Math.round((progress.current ?? 0) / progress.total * 100)}%` }]} />
              </View>
            ) : null}
          </View>
        )}
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
  reclassifyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  reclassifyButtonText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  progressTrack: { height: 4, backgroundColor: Colors.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6, marginTop: 12,
  },
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
