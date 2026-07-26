import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabHeaderProps } from '@react-navigation/bottom-tabs';
import { Colors } from '../lib/theme';
import { SyncHeader } from './SyncHeader';
import { DateRangeBar } from './DateRangeBar';

export function TabHeader({ options, route }: BottomTabHeaderProps) {
  const insets = useSafeAreaInsets();
  const title = options.title ?? route.name;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.titleRow}>
        <Text style={s.title}>{title}</Text>
        <SyncHeader />
      </View>
      <DateRangeBar />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
});
