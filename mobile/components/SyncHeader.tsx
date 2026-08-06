import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';
import { syncStatusText } from '../lib/syncStatus';

export function SyncHeader() {
  const { sync, loading, lastSyncedAt, lastSyncStatus, lastSyncMode, progress } = useSyncStore();
  const label = loading && progress ? progress.label : syncStatusText(lastSyncStatus, lastSyncedAt, lastSyncMode);
  const offline = lastSyncStatus === 'offline';
  return (
    <View style={s.row}>
      {label !== '' && (
        <Text style={[s.timestamp, offline && s.offline]}>{label}</Text>
      )}
      <TouchableOpacity style={s.button} onPress={sync} disabled={loading}>
        {loading ? (
          <ActivityIndicator size={12} color={Colors.primary} />
        ) : (
          <Feather name="refresh-cw" size={12} color={Colors.primary} />
        )}
        <Text style={s.buttonText}>Sync</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timestamp: { fontSize: 12, color: Colors.textSubtle },
  offline: { color: Colors.warning },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  buttonText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
});
