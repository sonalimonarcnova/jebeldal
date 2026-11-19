// Pure audio sniffing from the first bytes of a file. No runtime-specific APIs.

export type AudioFormat = 'm4a' | '3gp' | 'wav' | 'ogg' | 'webm' | 'flac' | 'mp3' | 'unknown';

export type SniffedAudio = {
  format: AudioFormat;
  /** extension to send to Groq; also used as the multipart filename */
  ext: string;
  mime: string;
  /** Groq accepts flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm */
  sttSupported: boolean;
};

/** A real recording is well above this; tiny files are error bodies or empty recorder output. */
export const MIN_AUDIO_BYTES = 1024;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const result = (format: AudioFormat, ext: string, mime: string, sttSupported = true): SniffedAudio => ({
  format,
  ext,
  mime,
  sttSupported,
});

export function sniffAudio(bytes: Uint8Array): SniffedAudio {
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    // 3GPP / 3GPP2 brands (Android AMR recordings). Groq does not accept these.
    if (brand.startsWith('3g')) return result('3gp', '3gp', 'audio/3gpp', false);
    return result('m4a', 'm4a', 'audio/mp4');
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return result('wav', 'wav', 'audio/wav');
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') return result('ogg', 'ogg', 'audio/ogg');
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return result('flac', 'flac', 'audio/flac');
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return result('webm', 'webm', 'audio/webm');
  }
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return result('mp3', 'mp3', 'audio/mpeg');
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return result('mp3', 'mp3', 'audio/mpeg');
  return result('unknown', 'bin', 'application/octet-stream', false);
}
