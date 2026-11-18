import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  HelperText,
  MD3LightTheme,
  PaperProvider,
  Text,
  TextInput,
} from 'react-native-paper';

import { supabase } from './src/lib/supabase';

function AppContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setErrorText(error.message);
      }
      setSessionEmail(data.session?.user.email ?? null);
      setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setSubmitting(true);
    setErrorText(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErrorText(error.message);
    } else {
      setEmail('');
      setPassword('');
    }
    setSubmitting(false);
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    setErrorText(null);
    const { error } = await supabase.auth.signOut();
    if (error) setErrorText(error.message);
    setSubmitting(false);
  };

  if (loadingSession) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineMedium">JebelDAL</Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Hosted Supabase scaffold + Expo mobile baseline
        </Text>

        {sessionEmail ? (
          <>
            <Text variant="titleMedium">Signed in as {sessionEmail}</Text>
            <Button
              mode="contained"
              onPress={handleSignOut}
              loading={submitting}
              disabled={submitting}
              style={styles.button}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <TextInput
              mode="outlined"
              label="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              mode="outlined"
              label="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.inputSpacing}
            />
            <Button
              mode="contained"
              onPress={handleSignIn}
              loading={submitting}
              disabled={submitting || !email || !password}
              style={styles.button}
            >
              Sign in
            </Button>
          </>
        )}

        <HelperText type="info">
          Create invited users in Supabase Auth first, then sign in here.
        </HelperText>
        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
      </ScrollView>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <PaperProvider theme={MD3LightTheme}>
      <AppContent />
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F8FB',
  },
  content: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  subtitle: {
    color: '#58606E',
  },
  inputSpacing: {
    marginTop: 4,
  },
  button: {
    marginTop: 8,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
