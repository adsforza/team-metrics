import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../lib/theme';
import { SyncHeader } from './SyncHeader';
import { DateRangeBar } from './DateRangeBar';

// Antes esto importaba BottomTabHeaderProps de '@react-navigation/bottom-tabs', que
// no es dependencia del proyecto ni esta en node_modules. Compilaba de casualidad
// -era type-only, asi que se borraba al emitir- pero dejaba `tsc --noEmit` en rojo
// de forma permanente, inutilizando el typecheck del mobile como gate.
// expo-router trae react-navigation bundleado pero no reexporta el tipo por su
// entrada publica, y tomarlo de su ruta interna de build seria fragil. Se declara
// aca lo unico que este componente consume: por tipado estructural, los props reales
// que pasa expo-router lo satisfacen.
type TabHeaderProps = {
  options: { title?: string };
  route: { name: string };
};

export function TabHeader({ options, route }: TabHeaderProps) {
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
