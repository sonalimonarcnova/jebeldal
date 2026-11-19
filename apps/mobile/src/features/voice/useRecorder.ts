import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { normaliseMetering, shouldLogMeterSample } from './meter';

export { normaliseMetering } from './meter';

export type RecorderUiState = 'idle' | 'recording' | 'processing' | 'denied' | 'error';

export const MAX_RECORDING_SECONDS = 180;
const LEVEL_COUNT = 40;
const POLL_MS = 100;

// HIGH_QUALITY = m4a container, AAC encoder, 44.1 kHz on iOS and Android. Metering must be enabled here:
// expo-audio reads isMeteringEnabled when the recorder is created (Android) / prepared (iOS).
const OPTIONS: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

export type UseRecorderOptions = {
  /** Called once per finished recording, both for a manual stop() and the 180 s auto-stop. Not called on cancel(). */
  onFinished?: (result: { uri: string; seconds: number }) => void;
  maxSeconds?: number;
};

export type UseRecorderResult = {
  state: RecorderUiState;
  seconds: number;
  /** Last 40 metering values, normalised 0–1, oldest first. */
  levels: number[];
  uri: string | null;
  error: string | null;
  start: () => Promise<void>;
  /** Stops and keeps the file. Moves to 'processing' until reset() is called. Returns the file uri. */
  stop: () => Promise<string | null>;
  /** Stops and discards the recording; back to 'idle'. */
  cancel: () => Promise<void>;
  /** Leave 'processing' / 'error' (e.g. after the upload finished) and return to 'idle'. */
  reset: () => void;
  /** Raw native recorder state for the dev screen (is audio really being captured?). */
  diagnostics: RecorderDiagnostics;
};

export type RecorderDiagnostics = {
  nativeRecording: boolean;
  durationMillis: number;
  /** bytes flushed to disk so far; should grow while recording */
  fileSize: number;
  /** raw metering in dBFS, undefined when the platform reports none */
  meteringDb: number | undefined;
  /** size of the finished file on disk, checked after stop */
  lastFileBytes: number | null;
};

export function useRecorder({ onFinished, maxSeconds = MAX_RECORDING_SECONDS }: UseRecorderOptions = {}): UseRecorderResult {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, POLL_MS);

  const [state, setState] = useState<RecorderUiState>('idle');
  const [levels, setLevels] = useState<number[]>([]);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFileBytes, setLastFileBytes] = useState<number | null>(null);

  const stateRef = useRef<RecorderUiState>('idle');
  const stoppingRef = useRef(false);
  /** True once the polled status has shown isRecording for the current session (guards against stale polls). */
  const sawRecordingRef = useRef(false);
  const meterSamplesRef = useRef(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const setUiState = useCallback((next: RecorderUiState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const seconds = state === 'recording' || state === 'processing' ? Math.floor(status.durationMillis / 1000) : 0;

  const releaseAudioSession = useCallback(async () => {
    // Give the speaker back (iOS routes playback to the earpiece while recording is allowed).
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  /** Shared by stop(), cancel() and the auto-stop. */
  const finish = useCallback(
    async (keep: boolean): Promise<string | null> => {
      if (stoppingRef.current) return null;
      stoppingRef.current = true;
      const secs = Math.floor(recorder.getStatus().durationMillis / 1000);
      try {
        // Always stop: Android only finalises (writes) the m4a file in stop(), even if isRecording already flipped.
        await recorder.stop();
      } catch {
        // stop() can throw if the native recorder already stopped itself (forDuration); the file is still there.
      }
      await releaseAudioSession();
      stoppingRef.current = false;

      const fileUri = recorder.uri;
      if (!keep) {
        setUri(null);
        setUiState('idle');
        return null;
      }
      const onDisk = fileUri ? fileSizeOnDisk(fileUri) : null;
      setLastFileBytes(onDisk);
      if (!fileUri || !onDisk) {
        setError(`No audio was saved (${fileUri ? 'file missing or empty' : 'no file'}). Please try again.`);
        setUiState('error');
        return null;
      }
      setUri(fileUri);
      setUiState('processing');
      onFinishedRef.current?.({ uri: fileUri, seconds: secs });
      return fileUri;
    },
    [recorder, releaseAudioSession, setUiState],
  );

  const start = useCallback(async () => {
    if (stateRef.current === 'recording') return;
    setError(null);
    setUri(null);
    setLevels([]);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setUiState('denied');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      sawRecordingRef.current = false;
      meterSamplesRef.current = 0;
      // forDuration is the native backstop; the effect below also stops at maxSeconds so onFinished fires.
      recorder.record({ forDuration: maxSeconds });
      setLastFileBytes(null);
      // Android's record() silently does nothing if the recorder is not prepared, which would give a flat
      // waveform and no file. Fail loudly instead.
      if (!recorder.getStatus().isRecording) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!recorder.getStatus().isRecording) {
          await recorder.stop().catch(() => undefined);
          await releaseAudioSession();
          setError('The microphone did not start. Close other apps using it and try again.');
          setUiState('error');
          return;
        }
      }
      setUiState('recording');
    } catch {
      await releaseAudioSession();
      setError('Could not start the microphone.');
      setUiState('error');
    }
  }, [maxSeconds, recorder, releaseAudioSession, setUiState]);

  const stop = useCallback(() => (stateRef.current === 'recording' ? finish(true) : Promise.resolve(null)), [finish]);
  const cancel = useCallback(async () => {
    if (stateRef.current === 'recording') await finish(false);
    else {
      setUri(null);
      setUiState('idle');
    }
  }, [finish, setUiState]);

  const reset = useCallback(() => {
    setError(null);
    setLevels([]);
    setUiState(stateRef.current === 'denied' ? 'denied' : 'idle');
  }, [setUiState]);

  // Waveform levels + auto-stop, driven by the polled recorder state.
  useEffect(() => {
    if (state !== 'recording') return;
    if (status.isRecording) {
      sawRecordingRef.current = true;
      const level = normaliseMetering(status.metering);
      if (__DEV__ && shouldLogMeterSample(meterSamplesRef.current)) {
        // Dev only: proves metering arrives (a flat waveform with `metering: undefined` = metering not enabled).
        console.log(`[voice] ${Platform.OS} metering #${meterSamplesRef.current}: ${status.metering ?? 'undefined'} dB → ${level.toFixed(2)}`);
      }
      meterSamplesRef.current += 1;
      setLevels((prev) => (prev.length >= LEVEL_COUNT ? [...prev.slice(prev.length - LEVEL_COUNT + 1), level] : [...prev, level]));
    }
    const hitCap = status.isRecording && status.durationMillis >= maxSeconds * 1000;
    // The native forDuration limit can stop the recorder before our own check does.
    const stoppedNatively = !status.isRecording && sawRecordingRef.current && !stoppingRef.current;
    if (hitCap || stoppedNatively) void finish(true);
  }, [finish, maxSeconds, state, status]);

  // Never leave the microphone running when the screen unmounts.
  useEffect(
    () => () => {
      if (stateRef.current === 'recording') {
        recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    },
    [recorder],
  );

  const diagnostics: RecorderDiagnostics = {
    nativeRecording: status.isRecording,
    durationMillis: status.durationMillis,
    fileSize: status.fileSize,
    meteringDb: status.metering,
    lastFileBytes,
  };

  return { state, seconds, levels, uri, error, start, stop, cancel, reset, diagnostics };
}

/** Size of a local file in bytes, or null if it does not exist / cannot be read. */
function fileSizeOnDisk(uri: string): number | null {
  try {
    const file = new File(uri.startsWith('/') ? `file://${uri}` : uri);
    return file.exists ? (file.size ?? null) : null;
  } catch {
    return null;
  }
}
