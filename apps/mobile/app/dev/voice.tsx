// Hidden developer route for the voice pipeline (task C1 step 3). Not linked from the UI.
// Open it with the dev URL, e.g. jebeldal://dev/voice or http://localhost:8081/dev/voice on Expo web.
// Release builds redirect home, so it cannot be reached in production.
import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { VoiceDevScreen } from '../../src/features/voice/VoiceDevScreen';

export default function VoiceDevRoute() {
  const { session, authLoading } = useAuth();

  if (!__DEV__) return <Redirect href="/" />;
  if (authLoading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <VoiceDevScreen />
    </SafeAreaView>
  );
}
