import { StyleSheet } from 'react-native';

export const Colors = {
  bg: '#0f172a',
  bgCard: '#1e293b',
  bgMuted: '#171923',
  border: '#2d3748',
  text: '#F7FAFC',
  textMuted: '#94a3b8',
  textSubtle: '#4A5568',
  primary: '#3182CE',
  primaryLight: '#63B3ED',
  success: '#68D391',
  warning: '#F6AD55',
  error: '#FC8181',
} as const;

export const Typography = StyleSheet.create({
  label: { fontSize: 12, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 },
  body: { fontSize: 14, color: Colors.text },
  bodyMuted: { fontSize: 14, color: Colors.textMuted },
  heading: { fontSize: 17, fontWeight: '700', color: Colors.text },
  number: { fontSize: 28, fontWeight: '700', color: Colors.text, lineHeight: 32 },
  numberSmall: { fontSize: 20, fontWeight: '700', color: Colors.textMuted },
});

export const Card = StyleSheet.create({
  base: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
});
