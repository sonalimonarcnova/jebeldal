import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';

export default function SignInRoute() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleSignIn = async () => {
    setSubmitting(true);
    setErrorText(null);
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="headlineLarge">JebelDAL</Text>
          <Text variant="bodyLarge" style={styles.subtitle}>
            Sign in with your invited driver account.
          </Text>

          <TextInput
            mode="outlined"
            label="Work email"
            accessibilityLabel="Work email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            disabled={submitting}
          />
          <TextInput
            mode="outlined"
            label="Password"
            accessibilityLabel="Password"
            secureTextEntry={!passwordVisible}
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            disabled={submitting}
            right={
              <TextInput.Icon
                icon={passwordVisible ? 'eye-off' : 'eye'}
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                onPress={() => setPasswordVisible((visible) => !visible)}
              />
            }
          />

          <View style={styles.actionGroup}>
            <Button
              mode="contained"
              onPress={() => void handleSignIn()}
              disabled={submitting || !email.trim() || !password}
              accessibilityLabel="Sign in"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
            {submitting ? <ActivityIndicator accessibilityLabel="Signing in" /> : null}
          </View>

          <Link href="/(auth)/forgot-password" asChild>
            <Button disabled={submitting}>Forgot password?</Button>
          </Link>

          <HelperText type="info">
            New drivers must be invited by their fleet administrator.
          </HelperText>
          {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F8FB',
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  subtitle: {
    color: '#58606E',
    marginBottom: 8,
  },
  actionGroup: {
    gap: 12,
  },
});
