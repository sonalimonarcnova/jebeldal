import { useCallback, useState, type ComponentProps } from 'react';
import { router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Card, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  documentFileCategories,
  driverFileCategoryLabel,
  walkaroundPhotoCategories,
  type DriverFile,
  type DriverFileCategory,
} from '../../src/features/files/model';
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

function FileRow({
  file,
  onOpen,
  onRetry,
}: {
  file: DriverFile;
  onOpen: (file: DriverFile) => void;
  onRetry: (file: DriverFile) => void;
}) {
  return (
    <View style={styles.fileRow}>
      <View style={styles.fileDetails}>
        <Text variant="bodyMedium">{driverFileCategoryLabel(file.category)}</Text>
        <Text variant="bodySmall" style={styles.secondary}>
          {file.uploadStatus === 'uploaded'
            ? new Date(file.createdAt).toLocaleDateString()
            : file.uploadStatus === 'pending'
              ? 'Upload pending'
              : 'Upload failed'}
        </Text>
      </View>
      {file.uploadStatus === 'uploaded' ? (
        <Button
          compact
          mode="text"
          icon="open-in-new"
          accessibilityLabel={`Open ${driverFileCategoryLabel(file.category)}`}
          onPress={() => onOpen(file)}
        >
          Open
        </Button>
      ) : (
        <Button
          compact
          mode="text"
          icon="refresh"
          accessibilityLabel={`Retry ${driverFileCategoryLabel(file.category)} upload`}
          onPress={() => onRetry(file)}
        >
          Retry
        </Button>
      )}
    </View>
  );
}

export default function DriverFilesRoute() {
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCategory, setBusyCategory] = useState<DriverFileCategory | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingDriverFile | null>(null);

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

  const retryFile = (file: DriverFile) => {
    if (file.mediaType === 'image') {
      void chooseTruckPhoto(file.category, file);
    } else {
      void chooseDocument(file.category, file);
    }
  };

  const renderCategory = (category: DriverFileCategory, icon: IconName, isPhoto: boolean) => {
    const categoryFiles = files.filter((file) => file.category === category);
    const hasUploadedFile = categoryFiles.some((file) => file.uploadStatus === 'uploaded');
    const isBusy = busyCategory === category;

    return (
      <View key={category} style={styles.categoryRow}>
        <View style={styles.categoryHeading}>
          <View style={[styles.iconBox, isPhoto ? styles.photoIcon : styles.documentIcon]}>
            <MaterialCommunityIcons
              name={icon}
              size={22}
              color={isPhoto ? palette.secondary : palette.primary}
              accessible={false}
            />
          </View>
          <View style={styles.fileDetails}>
            <Text variant="titleSmall">{driverFileCategoryLabel(category)}</Text>
            <Text variant="bodySmall" style={styles.secondary}>
              {hasUploadedFile ? 'Added' : isPhoto ? 'Walk-around photo' : 'PDF document'}
            </Text>
          </View>
          <Button
            mode={hasUploadedFile ? 'outlined' : 'contained'}
            compact
            icon={isPhoto ? 'camera-outline' : 'plus'}
            accessibilityLabel={`${hasUploadedFile ? 'Add another' : 'Add'} ${driverFileCategoryLabel(category)}`}
            onPress={() => void (isPhoto ? chooseTruckPhoto(category) : chooseDocument(category))}
            disabled={Boolean(busyCategory)}
            loading={isBusy}
          >
            {hasUploadedFile ? 'Add another' : 'Add'}
          </Button>
        </View>
        {categoryFiles.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            onOpen={(selected) => void openFile(selected)}
            onRetry={retryFile}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Button
            mode="text"
            icon="chevron-left"
            accessibilityLabel="Back to home"
            onPress={() => router.navigate('/(driver)/home')}
          >
            Home
          </Button>
          <Text variant="headlineMedium" style={styles.title}>Files</Text>
          <Text variant="bodyMedium" style={styles.secondary}>
            Your documents and truck photos
          </Text>
        </View>

        {actionError ? <HelperText type="error">{actionError}</HelperText> : null}
        {pendingUpload ? (
          <Card style={styles.card}>
            <Card.Content style={styles.pendingContent}>
              <Text variant="titleSmall">Upload not complete</Text>
              <Text variant="bodySmall" style={styles.secondary}>
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
            </Card.Content>
          </Card>
        ) : null}

        {loadError ? (
          <Card style={styles.card}>
            <Card.Content style={styles.pendingContent}>
              <Text variant="titleMedium">Files could not be loaded</Text>
              <HelperText type="error">{loadError}</HelperText>
              <Button mode="contained" onPress={() => void refreshFiles()}>
                Retry
              </Button>
            </Card.Content>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Card.Content style={styles.section}>
            <View>
              <Text variant="titleLarge">Documents</Text>
              <Text variant="bodyMedium" style={styles.secondary}>
                Add a PDF, up to 50 MB. Files are private to your account.
              </Text>
            </View>
            {loading ? <ActivityIndicator accessibilityLabel="Loading documents" /> : null}
            {documentFileCategories.map((category) =>
              renderCategory(category, 'file-document-outline', false),
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content style={styles.section}>
            <View>
              <Text variant="titleLarge">Truck photos</Text>
              <Text variant="bodyMedium" style={styles.secondary}>
                Capture one photo for each walk-around view.
              </Text>
            </View>
            {loading ? <ActivityIndicator accessibilityLabel="Loading truck photos" /> : null}
            {walkaroundPhotoCategories.map((category) =>
              renderCategory(category, 'camera-outline', true),
            )}
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    gap: 16,
    padding: 20,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingBottom: 28,
  },
  header: {
    gap: 4,
  },
  title: {
    color: palette.text,
  },
  secondary: {
    color: palette.mutedText,
  },
  section: {
    gap: 14,
    padding: 18,
  },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pendingContent: {
    gap: 8,
    padding: 18,
  },
  categoryRow: {
    gap: 8,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  categoryHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
  },
  fileDetails: {
    flex: 1,
    gap: 2,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  documentIcon: {
    backgroundColor: palette.primaryContainer,
  },
  photoIcon: {
    backgroundColor: palette.secondaryContainer,
  },
  fileRow: {
    alignItems: 'center',
    backgroundColor: palette.surfaceVariant,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingLeft: 12,
    paddingRight: 4,
  },
});
