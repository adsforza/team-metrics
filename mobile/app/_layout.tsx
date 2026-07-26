import { useState, useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getDb } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { SplashScreen } from '../components/SplashScreen';

export default function RootLayout() {
  const loadLastSynced = useSyncStore(s => s.loadLastSynced);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    getDb().catch(console.error);
    loadLastSynced();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      {splashDone
        ? <Stack screenOptions={{ headerShown: false }} />
        : <SplashScreen onDone={() => setSplashDone(true)} />
      }
    </>
  );
}
