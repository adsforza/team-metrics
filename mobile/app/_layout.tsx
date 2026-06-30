import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { getDb } from '../lib/db';
import { useSyncStore } from '../store/syncStore';

export default function RootLayout() {
  const loadLastSynced = useSyncStore(s => s.loadLastSynced);

  useEffect(() => {
    getDb().catch(console.error);
    loadLastSynced();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
