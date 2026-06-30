import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export function SyncHeader() {
  const { sync, loading, lastSyncedAt } = useSyncStore();
  return (
    <View style={s.row}>
      {lastSyncedAt && (
        <Text style={s.timestamp}>sync {timeAgo(lastSyncedAt)}</Text>
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
  timestamp: { fontSize: 10, color: Colors.textSubtle },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  buttonText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
});
