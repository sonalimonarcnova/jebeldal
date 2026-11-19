import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Card, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../src/lib/supabase';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

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
          <Link href="/(auth)/sign-in" asChild>
            <Button
              mode="text"
              icon="arrow-left"
              accessibilityLabel="Back to sign in"
              style={styles.backButton}
            >
              Back to sign in
            </Button>
          </Link>
          <View style={styles.header}>
            <Avatar.Icon
              size={56}
              icon="email-lock-outline"
              color={palette.primary}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.brandIcon}
            />
            <Text variant="headlineMedium" style={styles.title}>Reset your password</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Enter the work email linked to your invited driver account.
            </Text>
          </View>
          <Card mode="elevated" style={styles.card}>
            <Card.Content style={styles.form}>
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
                loading={submitting}
              >
                Send reset email
              </Button>
              {sent ? (
                <HelperText type="info">
                  If the address belongs to an invited account, reset instructions were sent.
                </HelperText>
              ) : null}
              {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
            </Card.Content>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: 24,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: 560,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginLeft: -8,
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    backgroundColor: palette.primaryContainer,
    marginBottom: 4,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: palette.mutedText,
    textAlign: 'center',
  },
  card: {
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
  },
  form: {
    gap: 16,
    padding: 20,
  },
});
