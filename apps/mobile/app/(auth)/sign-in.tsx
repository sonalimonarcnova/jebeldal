import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Card,
  HelperText,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

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
          <View style={styles.brand}>
            <Avatar.Icon
              size={64}
              icon="truck-fast-outline"
              color={palette.primary}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.brandIcon}
            />
            <Text variant="headlineMedium" style={styles.brandTitle}>JebelDAL</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Sign in with your invited driver account.
            </Text>
          </View>

          <Card mode="elevated" style={styles.signInCard}>
            <Card.Content style={styles.form}>
              <TextInput
                mode="outlined"
                label="Work email"
                accessibilityLabel="Work email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
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
                returnKeyType="done"
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
                  contentStyle={styles.primaryAction}
                >
                  {submitting ? 'Signing in...' : 'Sign in'}
                </Button>
                {submitting ? <ActivityIndicator accessibilityLabel="Signing in" /> : null}
              </View>

              <Link href="/(auth)/forgot-password" asChild>
                <Button disabled={submitting}>Forgot password?</Button>
              </Link>
            </Card.Content>
          </Card>

          <HelperText type="info" style={styles.invitation}>
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
    backgroundColor: palette.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: 20,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: 560,
  },
  brand: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  brandIcon: {
    backgroundColor: palette.primaryContainer,
    marginBottom: 4,
  },
  brandTitle: {
    color: palette.text,
    fontWeight: '700',
  },
  subtitle: {
    color: palette.mutedText,
    textAlign: 'center',
  },
  signInCard: {
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
  },
  form: {
    gap: 16,
    padding: 20,
  },
  actionGroup: {
    gap: 12,
  },
  primaryAction: {
    minHeight: 48,
  },
  invitation: {
    textAlign: 'center',
  },
});
