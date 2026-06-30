import { View, Text, StyleSheet } from 'react-native';

export default function IssuesScreen() {
  return (
    <View style={s.container}>
      <Text style={s.text}>Issues — próximamente</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#94a3b8' },
});
