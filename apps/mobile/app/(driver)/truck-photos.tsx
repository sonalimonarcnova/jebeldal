import { useCallback, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DriverFile, DriverFileCategory } from '../../src/features/files/model';
import {
  describeFileError,
  loadDriverFiles,
  prepareDriverFile,
  prepareDriverFileRetry,
  uploadPendingDriverFile,
  type PendingDriverFile,
  type SelectedDriverFile,
} from '../../src/features/files/repository';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

const walkaroundCategories: readonly { category: DriverFileCategory; label: string }[] = [
  { category: 'walkaround_front', label: 'Front' },
  { category: 'walkaround_driver_side', label: 'Driver side' },
  { category: 'walkaround_rear', label: 'Rear' },
  { category: 'walkaround_passenger_side', label: 'Passenger side' },
];

function latestByStatus(files: DriverFile[], status: DriverFile['uploadStatus']): DriverFile | null {
  return files.find((file) => file.uploadStatus === status) ?? null;
}

function statusLabel(files: DriverFile[]): 'missing' | 'pending' | 'failed' | 'added' {
  if (files.some((file) => file.uploadStatus === 'failed')) return 'failed';
  if (files.some((file) => file.uploadStatus === 'pending')) return 'pending';
  if (files.some((file) => file.uploadStatus === 'uploaded')) return 'added';
  return 'missing';
}

export default function TruckPhotosRoute() {
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingDriverFile | null>(null);
  const [busyCategory, setBusyCategory] = useState<DriverFileCategory | null>(null);

  const refreshFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFiles(await loadDriverFiles());
    } catch (error) {
      setLoadError(describeFileError(error, 'Could not load walk-around photos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshFiles();
    }, [refreshFiles]),
  );

  const saveSelectedFile = async (
    category: DriverFileCategory,
    asset: SelectedDriverFile,
    retryTarget?: DriverFile,
  ) => {
    setBusyCategory(category);
    setActionError(null);
    try {
      const prepared = retryTarget
        ? await prepareDriverFileRetry(retryTarget, asset)
        : await prepareDriverFile(category, asset);
      setPendingUpload(prepared);
      await uploadPendingDriverFile(prepared);
      setPendingUpload(null);
      await refreshFiles();
    } catch (error) {
      setActionError(describeFileError(error, 'The truck photo could not be saved.'));
    } finally {
      setBusyCategory(null);
    }
  };

  const chooseTruckPhoto = async (category: DriverFileCategory, retryTarget?: DriverFile) => {
    setActionError(null);
    try {
      if (Platform.OS === 'web') {
        const selection = await DocumentPicker.getDocumentAsync({
          type: ['image/jpeg', 'image/png', 'image/webp'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (selection.canceled) return;
        const asset = selection.assets[0];
        if (!asset) throw new Error('No photo was selected.');
        await saveSelectedFile(
          category,
          { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null },
          retryTarget,
        );
        return;
      }

      const currentPermission = await ImagePicker.getCameraPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : currentPermission.canAskAgain
          ? await ImagePicker.requestCameraPermissionsAsync()
          : currentPermission;
      if (!permission.granted) {
        throw new Error(permission.canAskAgain
          ? 'Allow camera access to take a walk-around photo.'
          : 'Camera access is disabled. Enable Camera access in Settings for this app.');
      }

      const capture = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (capture.canceled || !capture.assets[0]) return;

      const asset = capture.assets[0];
      await saveSelectedFile(
        category,
        { uri: asset.uri, name: asset.fileName ?? 'Truck photo.jpg', mimeType: asset.mimeType ?? null },
        retryTarget,
      );
    } catch (error) {
      setActionError(describeFileError(error, 'The truck photo could not be captured.'));
    }
  };

  const retryPendingUpload = async () => {
    if (!pendingUpload) return;
    setBusyCategory(pendingUpload.category);
    setActionError(null);
    try {
      await uploadPendingDriverFile(pendingUpload);
      setPendingUpload(null);
      await refreshFiles();
    } catch (error) {
      setActionError(describeFileError(error, 'Could not retry this upload.'));
    } finally {
      setBusyCategory(null);
    }
  };

  const chooseForSide = async (category: DriverFileCategory) => {
    const categoryFiles = files.filter((file) => file.category === category);
    const failed = latestByStatus(categoryFiles, 'failed');
    if (failed) {
      await chooseTruckPhoto(category, failed);
      return;
    }
    const pending = latestByStatus(categoryFiles, 'pending');
    if (pending) {
      await chooseTruckPhoto(category, pending);
      return;
    }
    await chooseTruckPhoto(category);
  };

  const uploadedSidesCount = useMemo(
    () =>
      walkaroundCategories.filter(({ category }) =>
        files.some((file) => file.category === category && file.uploadStatus === 'uploaded')).length,
    [files],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to files"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.topButton, pressed ? styles.pressed : null]}
            hitSlop={10}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={palette.text} />
            <Text variant="labelLarge" style={styles.topButtonText}>Back</Text>
          </Pressable>
          <Text variant="labelLarge" style={styles.stepText}>Step 4 of 4</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip truck photo setup"
            onPress={() => router.navigate('/(driver)/files')}
            style={({ pressed }) => [styles.topButton, pressed ? styles.pressed : null]}
            hitSlop={10}
          >
            <Text variant="labelLarge" style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.header}>
          <Text variant="headlineMedium" style={styles.title}>Photograph your unit</Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            A quick walk-around today makes new damage easy to prove later.
          </Text>
        </View>

        {loadError ? <HelperText type="error">{loadError}</HelperText> : null}
        {actionError ? <HelperText type="error">{actionError}</HelperText> : null}
        {pendingUpload ? (
          <View style={styles.pendingCard}>
            <Text variant="titleSmall">Upload not complete</Text>
            <Text variant="bodySmall" style={styles.pendingText}>
              Retry to finish syncing this side.
            </Text>
            <Button
              mode="contained"
              onPress={() => void retryPendingUpload()}
              disabled={Boolean(busyCategory)}
              loading={busyCategory === pendingUpload.category}
            >
              Retry upload
            </Button>
          </View>
        ) : null}

        <View style={styles.sideGrid}>
          {walkaroundCategories.map(({ category, label }) => {
            const filesForCategory = files.filter((file) => file.category === category);
            const status = statusLabel(filesForCategory);
            const isBusy = busyCategory === category;
            return (
              <Pressable
                key={category}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${isBusy ? 'saving' : status}`}
                onPress={() => void chooseForSide(category)}
                disabled={isBusy || loading}
                style={({ pressed }) => [
                  styles.sideButton,
                  status === 'added' && styles.sideButtonSuccess,
                  status === 'failed' && styles.sideButtonError,
                  pressed ? styles.pressed : null,
                ]}
              >
                <MaterialCommunityIcons
                  name={status === 'added' ? 'check-circle' : 'camera-outline'}
                  size={18}
                  color={status === 'added' ? palette.success : palette.text}
                />
                <Text variant="labelLarge" style={styles.sideLabel}>
                  {`${label}${isBusy ? ' · saving…' : ''}`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? <ActivityIndicator accessibilityLabel="Loading truck photo progress" /> : null}

        <Text variant="bodySmall" style={styles.infoText}>
          Photos are time-stamped and tagged with GPS when available.
        </Text>

        <Button
          mode="contained"
          onPress={() => router.navigate('/(driver)/files')}
          accessibilityLabel={`Finish setup with ${uploadedSidesCount} of ${walkaroundCategories.length} sides uploaded`}
        >
          {`Finish setup · ${uploadedSidesCount} of ${walkaroundCategories.length}`}
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
    gap: 14,
    maxWidth: 760,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 12,
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
  skipText: {
    color: palette.primary,
    fontWeight: '700',
  },
  header: {
    gap: 6,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
  subtitle: {
    color: palette.mutedText,
  },
  pendingCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 14,
  },
  pendingText: {
    color: palette.mutedText,
  },
  sideGrid: {
    gap: 10,
  },
  sideButton: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  sideButtonSuccess: {
    borderColor: '#86EFAC',
    backgroundColor: '#ECFDF5',
  },
  sideButtonError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  sideLabel: {
    color: palette.text,
    fontWeight: '600',
  },
  infoText: {
    color: palette.mutedText,
  },
  pressed: {
    opacity: 0.86,
  },
});
