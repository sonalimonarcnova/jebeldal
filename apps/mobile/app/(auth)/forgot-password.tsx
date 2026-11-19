import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../src/lib/supabase';

export default function ForgotPasswordRoute() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const requestReset = async () => {
    setSubmitting(true);
    setErrorText(null);
    setSent(false);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        throw new Error(error.message);
      }
      setSent(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Password reset request failed.');
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
          <Text variant="headlineMedium">Reset your password</Text>
          <Text variant="bodyMedium">Enter your invited driver email address.</Text>
          <TextInput
            mode="outlined"
            label="Work email"
            accessibilityLabel="Work email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            disabled={submitting || sent}
          />
          <Button
            mode="contained"
            onPress={() => void requestReset()}
            disabled={submitting || !email.trim() || sent}
          >
            Send reset email
          </Button>
          {sent ? (
            <HelperText type="info">
              If the address belongs to an invited account, reset instructions were sent.
            </HelperText>
          ) : null}
          {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
          <Link href="/(auth)/sign-in" asChild>
            <Button>Back to sign in</Button>
          </Link>
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
});
