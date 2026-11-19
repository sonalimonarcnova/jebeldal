import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import {
  markFaceIdReady,
  runBiometricSetupPrompt,
} from '../../src/features/home/deviceAuth';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

export default function DriverFaceSetupRoute() {
  const { session } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleContinue = async () => {
    setSubmitting(true);
    setErrorText(null);
    try {
      if (session?.user.id) {
        await runBiometricSetupPrompt();
        await markFaceIdReady(session.user.id);
      }
      router.replace({
        pathname: '/(driver)/files',
        params: { tab: 'documents', setup: '1' },
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Face ID setup could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.topButton, pressed ? styles.pressed : null]}
            hitSlop={10}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={palette.text} />
            <Text variant="labelLarge" style={styles.topButtonText}>Back</Text>
          </Pressable>
          <Text variant="labelLarge" style={styles.stepText}>Step 2 of 4</Text>
        </View>

        <View style={styles.faceCard}>
          <View style={styles.faceIconWrap}>
            <MaterialCommunityIcons name="face-recognition" size={86} color={palette.text} />
          </View>
          <Text variant="headlineSmall" style={styles.title}>Face recognized</Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            You can sign in to JebelAI with Face ID.
          </Text>
        </View>

        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}

        <Button
          mode="contained"
          onPress={() => void handleContinue()}
          loading={submitting}
          disabled={submitting}
        >
          Continue
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    alignSelf: 'center',
    gap: 20,
    maxWidth: 520,
    minHeight: '100%',
    paddingBottom: 28,
    paddingHorizontal: 24,
    paddingTop: 14,
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 8,
  },
  topButtonText: {
    color: palette.text,
    fontWeight: '600',
  },
  stepText: {
    color: palette.mutedText,
    fontWeight: '600',
  },
  faceCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  faceIconWrap: {
    alignItems: 'center',
    borderRadius: 44,
    height: 108,
    justifyContent: 'center',
    width: 108,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
  subtitle: {
    color: palette.mutedText,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.86,
  },
});
