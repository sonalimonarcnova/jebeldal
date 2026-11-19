// Run: deno test supabase/functions/process-incident-turn/   (or: node scripts/test-voice.mjs)
import { strictEqual } from 'node:assert/strict';
import { sniffAudio } from './audio.ts';

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array([...out, ...new Array(32).fill(0)]);
};

Deno.test('m4a/mp4 (ftyp at offset 4) is supported, sent as audio.m4a / audio/mp4', () => {
  for (const brand of ['M4A ', 'mp42', 'isom']) {
    const s = sniffAudio(bytes([0, 0, 0, 0x20], 'ftyp', brand));
    strictEqual(s.format, 'm4a');
    strictEqual(s.ext, 'm4a');
    strictEqual(s.mime, 'audio/mp4');
    strictEqual(s.sttSupported, true);
  }
});

Deno.test('3gp (ftyp3gp*) is detected and not supported by STT', () => {
  const s = sniffAudio(bytes([0, 0, 0, 0x18], 'ftyp', '3gp4'));
  strictEqual(s.format, '3gp');
  strictEqual(s.sttSupported, false);
});

Deno.test('wav, ogg, flac, webm and mp3 are recognised', () => {
  strictEqual(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'WAVE')).format, 'wav');
  strictEqual(sniffAudio(bytes('OggS')).format, 'ogg');
  strictEqual(sniffAudio(bytes('fLaC')).format, 'flac');
  strictEqual(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3])).format, 'webm');
  strictEqual(sniffAudio(bytes('ID3')).format, 'mp3');
});

Deno.test('a text error body ("File not found") is unknown and unsupported', () => {
  const s = sniffAudio(new TextEncoder().encode('File not found'));
  strictEqual(s.format, 'unknown');
  strictEqual(s.sttSupported, false);
});
