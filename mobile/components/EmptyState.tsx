import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';

export function EmptyState({ subtitle = 'Sincronizá para ver las métricas' }: { subtitle?: string }) {
  const { sync, loading } = useSyncStore();
  return (
    <View style={s.container}>
      <Feather name="inbox" size={40} color={Colors.textSubtle} />
      <Text style={s.title}>Sin datos</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      <TouchableOpacity style={s.button} onPress={sync} disabled={loading}>
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={s.buttonText}>{loading ? 'Sincronizando…' : 'Sincronizar ahora'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  title: { fontSize: 16, fontWeight: '600', color: Colors.text, marginTop: 12 },
  subtitle: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
