import { useState, useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { getDb } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { SplashScreen } from '../components/SplashScreen';

export default function RootLayout() {
  const loadLastSynced = useSyncStore(s => s.loadLastSynced);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    getDb().catch(console.error);
    loadLastSynced().then(() => {
      // best-effort: en casa (server up) refresca; offline el pre-check corta y marca offline.
      useSyncStore.getState().sync();
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') useSyncStore.getState().sync(); });
    const id = setInterval(() => { useSyncStore.getState().sync(); }, 15 * 60 * 1000);
    return () => { sub.remove(); clearInterval(id); };
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
