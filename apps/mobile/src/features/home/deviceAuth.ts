import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

const faceIdSetupKeyPrefix = 'jebeldal:face-id-ready:';

function faceIdStorageKey(userId: string): string {
  return `${faceIdSetupKeyPrefix}${userId}`;
}

export async function isFaceIdReady(userId: string): Promise<boolean> {
  const value = await AsyncStorage.getItem(faceIdStorageKey(userId));
  return value === 'true';
}

export async function markFaceIdReady(userId: string): Promise<void> {
  await AsyncStorage.setItem(faceIdStorageKey(userId), 'true');
}

export async function runBiometricSetupPrompt(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Device biometric setup is available on an iOS or Android device.');
  }
  if (!(await LocalAuthentication.hasHardwareAsync())) {
    throw new Error('This device does not support biometric authentication.');
  }
  if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) {
    throw new Error('Set up Face ID or a fingerprint in your device settings first.');
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Set up JebelDAL device authentication',
    cancelLabel: 'Cancel',
    disableDeviceFallback: true,
  });
  if (!result.success) {
    throw new Error('Device authentication was not completed. Your setup is unchanged.');
  }
}
