import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import { useFilterStore, type TimeRange } from '../store/filterStore';
import { useSyncStore } from '../store/syncStore';

const RANGES: { label: string; value: TimeRange }[] = [
  { label: '30d', value: '30d' },
  { label: '60d', value: '60d' },
  { label: '90d', value: '90d' },
  { label: '180d', value: '180d' },
  { label: '360d', value: '360d' },
];

export function DateRangeBar() {
  const { timeRange, setTimeRange } = useFilterStore();
  const { sync, loading } = useSyncStore();

  const handleSelect = (range: TimeRange) => {
    if (range === timeRange) return;
    setTimeRange(range);
    sync();
  };

  return (
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
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  chip: {
    paddingHorizontal: 10,
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
  chipText: { fontSize: 14, color: Colors.textMuted },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
