import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { getDb } from '../lib/db';

export default function RootLayout() {
  useEffect(() => {
    getDb().catch(console.error);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
