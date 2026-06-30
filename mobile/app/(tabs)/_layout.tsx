import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ColorValue } from 'react-native';
import { Colors } from '../../lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

function tabIcon(name: FeatherName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Feather name={name} size={size} color={color as string} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSubtle,
        tabBarStyle: {
          backgroundColor: Colors.bgMuted,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
        },
        headerStyle: { backgroundColor: Colors.bg },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '600' },
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'Inicio',   tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="equipo"   options={{ title: 'Equipo',   tabBarIcon: tabIcon('users') }} />
      <Tabs.Screen name="issues"   options={{ title: 'Issues',   tabBarIcon: tabIcon('file-text') }} />
      <Tabs.Screen name="analisis" options={{ title: 'Análisis', tabBarIcon: tabIcon('bar-chart-2') }} />
      <Tabs.Screen name="ajustes"  options={{ title: 'Ajustes',  tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
