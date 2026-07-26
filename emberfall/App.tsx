import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameScreen } from './src/screens/GameScreen';

export default function App(): ReactNode {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GameScreen />
    </SafeAreaProvider>
  );
}
