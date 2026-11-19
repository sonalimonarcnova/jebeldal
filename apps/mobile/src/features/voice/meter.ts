// Pure metering helpers (no React Native imports, unit-tested in tests/voice.test.mjs).

/** Metering is dBFS: Android = 20·log10(maxAmplitude/32767) (-160 when silent), iOS = averagePower (≈ -160…0). */
export const METER_FLOOR_DB = -60;

/** -60…0 dB → 0…1 (speech sits roughly in -45…-10 dB). Missing / non-finite / silent readings are 0. */
export function normaliseMetering(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/** Dev-only sampling for the "is metering arriving?" log: the first 5 readings, then every 25th. */
export function shouldLogMeterSample(index: number): boolean {
  return index < 5 || index % 25 === 0;
}
