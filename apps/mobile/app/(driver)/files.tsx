import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DriverFile, DriverFileCategory } from '../../src/features/files/model';
import {
  createDriverFileUrl,
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

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ActiveTab = 'documents' | 'photos';
type FileSlot = {
  key: string;
  label: string;
  helperText: string;
  emptyText: string;
  categories: DriverFileCategory[];
  icon: IconName;
};

const documentSlots: readonly FileSlot[] = [
  {
    key: 'commercial_license',
    label: 'Commercial driver\'s license',
    helperText: 'Front and back',
    emptyText: 'Front and back · tap or drop',
    categories: ['cdl_front', 'cdl_back'],
    icon: 'file-document-outline',
  },
  {
    key: 'dot_medical',
    label: 'DOT medical card',
    helperText: 'Current examiner\'s certificate',
    emptyText: 'Current examiner\'s certificate · tap or drop',
    categories: ['medical_card'],
    icon: 'file-document-outline',
  },
  {
    key: 'vehicle_registration',
    label: 'Vehicle registration',
    helperText: 'Cab card for your unit',
    emptyText: 'Cab card for your unit · tap or drop',
    categories: ['registration'],
    icon: 'file-document-outline',
  },
  {
    key: 'insurance_card',
    label: 'Insurance card',
    helperText: 'Keep it in the cab, too',
    emptyText: 'Keep it in the cab, too · tap or drop',
    categories: ['insurance_card'],
    icon: 'file-document-outline',
  },
];

const photoCategories: readonly { category: DriverFileCategory; label: string }[] = [
  { category: 'walkaround_front', label: 'Front' },
  { category: 'walkaround_driver_side', label: 'Driver side' },
  { category: 'walkaround_rear', label: 'Rear' },
  { category: 'walkaround_passenger_side', label: 'Passenger side' },
];

function latestByStatus(files: DriverFile[], status: DriverFile['uploadStatus']): DriverFile | null {
  return files.find((file) => file.uploadStatus === status) ?? null;
}

function slotSubtitle(slot: FileSlot, files: DriverFile[]): string {
  const requiredCount = slot.categories.length;
  const uploadedCount = slot.categories.filter((category) =>
    files.some((file) => file.category === category && file.uploadStatus === 'uploaded')).length;

  if (files.some((file) => file.uploadStatus === 'failed')) return 'Upload failed · tap to retry';
  if (files.some((file) => file.uploadStatus === 'pending')) return 'Upload pending · tap to retry';
  if (uploadedCount >= requiredCount) return slot.helperText;
  if (uploadedCount > 0) return `${uploadedCount}/${requiredCount} added · tap to finish`;
  return slot.emptyText;
}

function photoStatus(files: DriverFile[]): { label: string; tone: 'neutral' | 'error' | 'success' } {
  if (files.some((file) => file.uploadStatus === 'failed')) return { label: 'failed', tone: 'error' };
  if (files.some((file) => file.uploadStatus === 'pending')) return { label: 'pending', tone: 'neutral' };
  if (files.some((file) => file.uploadStatus === 'uploaded')) return { label: 'added', tone: 'success' };
  return { label: 'missing', tone: 'neutral' };
}

export default function DriverFilesRoute() {
  const { tab, setup } = useLocalSearchParams<{ tab?: string; setup?: string }>();
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCategory, setBusyCategory] = useState<DriverFileCategory | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingDriverFile | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('documents');
  const inSetupFlow = setup === '1' || setup === 'true';

  useFocusEffect(
    useCallback(() => {
      if (tab === 'photos') {
        setActiveTab('photos');
      } else if (tab === 'documents') {
        setActiveTab('documents');
      }
    }, [tab]),
  );

  const refreshFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFiles(await loadDriverFiles());
    } catch (error) {
      setLoadError(describeFileError(error, 'Could not load your files.'));
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
      setActionError(describeFileError(error, 'The file could not be uploaded.'));
    } finally {
      setBusyCategory(null);
    }
  };

  const chooseDocument = async (category: DriverFileCategory, retryTarget?: DriverFile) => {
    setActionError(null);
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) throw new Error('No document was selected.');
      await saveSelectedFile(
        category,
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null },
        retryTarget,
      );
    } catch (error) {
      setActionError(describeFileError(error, 'The selected document could not be added.'));
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
          : 'Camera access is disabled. Enable it in Settings to take a walk-around photo.');
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
      setActionError(describeFileError(error, 'The truck photo could not be added.'));
    }
  };

  const pickForCategory = useCallback(async (category: DriverFileCategory, retryTarget?: DriverFile) => {
    const isPhotoCategory = category.startsWith('walkaround_');
    if (isPhotoCategory) {
      await chooseTruckPhoto(category, retryTarget);
    } else {
      await chooseDocument(category, retryTarget);
    }
  }, []);

  const retryUpload = async () => {
    if (!pendingUpload) return;
    setBusyCategory(pendingUpload.category);
    setActionError(null);
    try {
      await uploadPendingDriverFile(pendingUpload);
      setPendingUpload(null);
      await refreshFiles();
    } catch (error) {
      setActionError(describeFileError(error, 'The file upload could not be retried.'));
    } finally {
      setBusyCategory(null);
    }
  };

  const openFile = async (file: DriverFile) => {
    setActionError(null);
    try {
      await Linking.openURL(await createDriverFileUrl(file.objectPath));
    } catch (error) {
      setActionError(describeFileError(error, 'The file could not be opened.'));
    }
  };

  const handleDocumentSlotPress = async (slot: FileSlot) => {
    const slotFiles = files.filter((file) => slot.categories.includes(file.category));
    const failedFile = latestByStatus(slotFiles, 'failed');
    if (failedFile) {
      await pickForCategory(failedFile.category, failedFile);
      return;
    }

    const pendingFile = latestByStatus(slotFiles, 'pending');
    if (pendingFile) {
      await pickForCategory(pendingFile.category, pendingFile);
      return;
    }

    const missingCategories = slot.categories.filter((category) =>
      !slotFiles.some((file) => file.category === category && file.uploadStatus === 'uploaded'));
    if (missingCategories.length > 1 && slot.key === 'commercial_license' && Platform.OS !== 'web') {
      Alert.alert(
        'Commercial driver\'s license',
        'Choose which side to upload.',
        [
          { text: 'Front', onPress: () => { void pickForCategory('cdl_front'); } },
          { text: 'Back', onPress: () => { void pickForCategory('cdl_back'); } },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    if (missingCategories.length > 0) {
      await pickForCategory(missingCategories[0]);
      return;
    }

    const uploadedFile = latestByStatus(slotFiles, 'uploaded');
    if (uploadedFile) await openFile(uploadedFile);
  };

  const handlePhotoCategoryPress = async (category: DriverFileCategory) => {
    const categoryFiles = files.filter((file) => file.category === category);
    const failed = latestByStatus(categoryFiles, 'failed');
    if (failed) {
      await pickForCategory(category, failed);
      return;
    }
    const pending = latestByStatus(categoryFiles, 'pending');
    if (pending) {
      await pickForCategory(category, pending);
      return;
    }
    const uploaded = latestByStatus(categoryFiles, 'uploaded');
    if (uploaded) {
      await openFile(uploaded);
      return;
    }
    await pickForCategory(category);
  };

  const handleRetakeWalkaround = async () => {
    if (inSetupFlow) {
      router.push({
        pathname: '/(driver)/truck-photos',
        params: { setup: '1' },
      });
      return;
    }
    router.push('/(driver)/truck-photos');
  };

  const documentRows = useMemo(
    () => documentSlots.map((slot) => {
      const slotFiles = files.filter((file) => slot.categories.includes(file.category));
      const isBusy = slot.categories.includes(busyCategory ?? 'cdl_front');
      return {
        slot,
        subtitle: slotSubtitle(slot, slotFiles),
        isBusy,
      };
    }),
    [files, busyCategory],
  );

  const uploadedDocumentSlotsCount = useMemo(
    () => documentSlots.filter((slot) =>
      slot.categories.every((category) =>
        files.some((file) => file.category === category && file.uploadStatus === 'uploaded'))).length,
    [files],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {inSetupFlow ? (
          <View style={styles.setupTopBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.replace('/(driver)/face')}
              style={({ pressed }) => [styles.setupTopButton, pressed ? styles.pressed : null]}
              hitSlop={10}
            >
              <MaterialCommunityIcons name="arrow-left" size={20} color={palette.text} />
              <Text variant="labelLarge" style={styles.setupTopButtonText}>Back</Text>
            </Pressable>
            <Text variant="labelLarge" style={styles.setupStepText}>Step 3 of 4</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip documents"
              onPress={() => router.replace({
                pathname: '/(driver)/truck-photos',
                params: { setup: '1' },
              })}
              style={({ pressed }) => [styles.setupTopButton, pressed ? styles.pressed : null]}
              hitSlop={10}
            >
              <Text variant="labelLarge" style={styles.setupSkipText}>Skip</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.header}>
          <Text variant="headlineLarge" style={styles.title}>
            {inSetupFlow ? 'Drop your documents' : 'Files'}
          </Text>
          <Text variant="bodyLarge" style={styles.subtitle}>
            {inSetupFlow
              ? 'Scan, pick a photo, or drop a file. We read the dates so you get a heads-up before anything expires.'
              : 'Everything your safety team or insurer may ask for.'}
          </Text>
          <View style={styles.segmented} accessibilityRole="tablist" accessibilityLabel="File type">
            <Pressable
              style={({ pressed }) => [
                styles.segmentButton,
                activeTab === 'documents' && styles.segmentButtonActive,
                pressed && styles.pressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'documents' }}
              onPress={() => setActiveTab('documents')}
            >
              <Text variant="titleMedium" style={activeTab === 'documents' ? styles.segmentTextActive : styles.segmentText}>
                Documents
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.segmentButton,
                activeTab === 'photos' && styles.segmentButtonActive,
                pressed && styles.pressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'photos' }}
              onPress={() => setActiveTab('photos')}
            >
              <Text variant="titleMedium" style={activeTab === 'photos' ? styles.segmentTextActive : styles.segmentText}>
                Photos
              </Text>
            </Pressable>
          </View>
        </View>

        {actionError ? <HelperText type="error">{actionError}</HelperText> : null}
        {pendingUpload ? (
          <View style={styles.feedbackCard}>
            <Text variant="titleSmall">Upload not complete</Text>
            <Text variant="bodySmall" style={styles.feedbackText}>
              Retry the same file to finish saving it securely.
            </Text>
            <Button
              mode="contained"
              onPress={() => void retryUpload()}
              disabled={Boolean(busyCategory)}
              loading={busyCategory === pendingUpload.category}
            >
              Retry upload
            </Button>
          </View>
        ) : null}
        {loadError ? (
          <View style={styles.feedbackCard}>
            <Text variant="titleSmall">Files could not be loaded</Text>
            <HelperText type="error">{loadError}</HelperText>
            <Button mode="contained" onPress={() => void refreshFiles()}>
              Retry
            </Button>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator accessibilityLabel="Loading files" />
          </View>
        ) : null}

        {!loading && activeTab === 'documents' ? (
          <View style={styles.list}>
            {documentRows.map(({ slot, subtitle, isBusy }) => (
              <Pressable
                key={slot.key}
                style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${slot.label} ${subtitle}`}
                onPress={() => void handleDocumentSlotPress(slot)}
                disabled={isBusy}
              >
                <View style={styles.iconBox}>
                  <MaterialCommunityIcons
                    name={slot.icon}
                    size={24}
                    color="#9CA3AF"
                    accessible={false}
                  />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text variant="titleMedium" style={styles.rowTitle}>{slot.label}</Text>
                  <Text variant="bodyMedium" style={styles.rowSubtitle}>{subtitle}</Text>
                </View>
                {isBusy ? <ActivityIndicator size="small" accessibilityLabel={`Uploading ${slot.label}`} /> : null}
              </Pressable>
            ))}
            {inSetupFlow ? (
              <Button
                mode="contained"
                onPress={() => router.replace({
                  pathname: '/(driver)/truck-photos',
                  params: { setup: '1' },
                })}
                accessibilityLabel={`Continue with ${uploadedDocumentSlotsCount} of ${documentSlots.length} document slots added`}
              >
                {`Continue · ${uploadedDocumentSlotsCount} of ${documentSlots.length} added`}
              </Button>
            ) : null}
          </View>
        ) : null}

        {!loading && activeTab === 'photos' ? (
          <View style={styles.photosCard}>
            <View style={styles.photosHeader}>
              <Text variant="titleMedium" style={styles.photosTitle}>Unit walk-around</Text>
              <Pressable
                style={({ pressed }) => [styles.retakeButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Retake walk-around photos"
                onPress={() => void handleRetakeWalkaround()}
                hitSlop={10}
              >
                <Text variant="labelLarge" style={styles.retakeText}>Retake</Text>
              </Pressable>
            </View>
            <View style={styles.photoStatuses}>
              {photoCategories.map((item) => {
                const categoryFiles = files.filter((file) => file.category === item.category);
                const status = photoStatus(categoryFiles);
                const isBusy = busyCategory === item.category;
                return (
                  <Pressable
                    key={item.category}
                    style={({ pressed }) => [
                      styles.photoChip,
                      status.tone === 'error' && styles.photoChipError,
                      status.tone === 'success' && styles.photoChipSuccess,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} ${status.label}`}
                    onPress={() => void handlePhotoCategoryPress(item.category)}
                    disabled={isBusy}
                  >
                    <Text variant="labelMedium" style={styles.photoChipText}>
                      {`${item.label} · ${isBusy ? 'saving…' : status.label}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="bodySmall" style={styles.photoFooter}>
              Tap a side to add, retry, or open the latest photo.
            </Text>
            <Text variant="bodySmall" style={styles.photoFooter}>
              From incident reports
            </Text>
          </View>
        ) : null}
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
    paddingBottom: 32,
    paddingHorizontal: 18,
    paddingTop: 14,
    width: '100%',
  },
  setupTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  setupTopButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 8,
  },
  setupTopButtonText: {
    color: palette.text,
    fontWeight: '600',
  },
  setupStepText: {
    color: palette.mutedText,
    fontWeight: '600',
  },
  setupSkipText: {
    color: palette.primary,
    fontWeight: '700',
  },
  header: {
    gap: 8,
  },
  title: {
    color: '#111827',
    fontWeight: '700',
  },
  subtitle: {
    color: '#6B7280',
  },
  segmented: {
    backgroundColor: '#E5E7EB',
    borderRadius: 14,
    flexDirection: 'row',
    padding: 4,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  segmentButtonActive: {
    backgroundColor: palette.surface,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  segmentText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#111827',
    fontWeight: '700',
  },
  feedbackCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 14,
  },
  feedbackText: {
    color: palette.mutedText,
  },
  loadingRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  list: {
    gap: 10,
  },
  rowCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: '#D1D5DB',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    minHeight: 88,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    marginRight: 14,
    width: 44,
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: '#111827',
    fontWeight: '700',
  },
  rowSubtitle: {
    color: '#6B7280',
  },
  photosCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 14,
  },
  photosHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photosTitle: {
    color: '#111827',
    fontWeight: '700',
  },
  retakeButton: {
    borderRadius: 10,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  retakeText: {
    color: palette.primary,
    fontWeight: '700',
  },
  photoStatuses: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoChip: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  photoChipError: {
    backgroundColor: '#FEE2E2',
  },
  photoChipSuccess: {
    backgroundColor: '#DCFCE7',
  },
  photoChipText: {
    color: '#374151',
    fontWeight: '600',
  },
  photoFooter: {
    color: '#6B7280',
  },
  pressed: {
    opacity: 0.92,
  },
});
