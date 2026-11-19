import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import { supabase } from './supabase';

export const EVIDENCE_BUCKET = 'incident-evidence';

export type EvidenceMediaType = 'audio' | 'photo';

const MEDIA: Record<EvidenceMediaType, { ext: string; contentType: string }> = {
  audio: { ext: 'm4a', contentType: 'audio/mp4' },
  photo: { ext: 'jpg', contentType: 'image/jpeg' },
};

export type EvidenceErrorCode =
  | 'NOT_SIGNED_IN'
  | 'NO_PROFILE'
  | 'FILE_READ_FAILED'
  | 'ROW_FAILED'
  | 'UPLOAD_FAILED';

/** Thrown by uploadEvidence. Pass `evidenceId` back in to retry without creating a second row. */
export class EvidenceUploadError extends Error {
  readonly code: EvidenceErrorCode;
  readonly evidenceId: string | null;
  readonly retryable: boolean;
  constructor(code: EvidenceErrorCode, message: string, evidenceId: string | null, retryable: boolean) {
    super(message);
    this.name = 'EvidenceUploadError';
    this.code = code;
    this.evidenceId = evidenceId;
    this.retryable = retryable;
  }
}

export type UploadEvidenceInput = {
  revisionId: string;
  uri: string;
  mediaType: EvidenceMediaType;
  /** TODO(B1): stored once evidence.question_key exists (DB v2). Accepted now so callers don't change later. */
  questionKey?: string;
  /** Reuse on retry (from EvidenceUploadError.evidenceId) so the same row and storage path are used. */
  evidenceId?: string;
};

export type UploadedEvidence = { evidenceId: string; objectPath: string; sizeBytes: number };

type EvidenceRow = { id: string; object_path: string; upload_status: 'pending' | 'uploaded' | 'failed'; size_bytes: number | null };

/** Files smaller than this are not a real recording or photo (empty output or an error body). */
const MIN_FILE_BYTES: Record<EvidenceMediaType, number> = { audio: 1024, photo: 1024 };

class LocalFileError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

/** Recorder/picker URIs are sometimes bare absolute paths; fetch() needs a file:// URL for those. */
export function toFileUrl(uri: string): string {
  return uri.startsWith('/') ? `file://${uri}` : uri;
}

/** m4a/mp4: "ftyp" at offset 4 (brand not 3gp*). JPEG: FF D8 FF. */
export function hasExpectedSignature(bytes: Uint8Array, mediaType: EvidenceMediaType): boolean {
  if (mediaType === 'photo') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (bytes.length < 12) return false;
  const ascii = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  return ascii(4) === 'ftyp' && !ascii(8).startsWith('3g');
}

/**
 * Reads the local recording/photo with expo-file-system (fetch() on file:// URIs is unreliable on devices and
 * can return an error body such as "File not found" instead of throwing).
 */
async function readLocalFile(uri: string, mediaType: EvidenceMediaType): Promise<Uint8Array> {
  const url = toFileUrl(uri);
  const scheme = url.split(':')[0] || 'none';
  let file: File;
  try {
    file = new File(url);
  } catch {
    throw new LocalFileError(`invalid file uri, scheme ${scheme}`);
  }
  if (!file.exists) throw new LocalFileError(`file does not exist, scheme ${scheme}`);

  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch {
    throw new LocalFileError(`read failed, size ${file.size ?? 'unknown'}, scheme ${scheme}`);
  }
  if (bytes.byteLength < MIN_FILE_BYTES[mediaType]) throw new LocalFileError(`${bytes.byteLength} bytes, scheme ${scheme}`);
  if (!hasExpectedSignature(bytes.subarray(0, 16), mediaType)) {
    throw new LocalFileError(`not ${mediaType === 'audio' ? 'm4a' : 'jpeg'} data, ${bytes.byteLength} bytes, scheme ${scheme}`);
  }
  return bytes;
}

async function markFailed(evidenceId: string) {
  await supabase.from('evidence').update({ upload_status: 'failed' }).eq('id', evidenceId);
}

/**
 * Evidence row first (pending) → upload to {org}/{revision}/{evidence}.{ext} → mark uploaded (docs/sprint-plan.md §3.4).
 * Idempotent per evidenceId: an existing row is reused, an already-uploaded one is returned as is.
 */
export async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadedEvidence> {
  const { revisionId, uri, mediaType } = input;
  const evidenceId = input.evidenceId ?? randomUUID();
  const { ext, contentType } = MEDIA[mediaType];

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new EvidenceUploadError('NOT_SIGNED_IN', 'Sign in again to upload.', null, false);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle<{ organization_id: string }>();
  if (profileError) throw new EvidenceUploadError('NO_PROFILE', 'Could not load your profile.', null, true);
  if (!profile) throw new EvidenceUploadError('NO_PROFILE', 'Your profile is not set up yet.', null, false);

  const objectPath = `${profile.organization_id}/${revisionId}/${evidenceId}.${ext}`;

  // 1. Row (reuse on retry).
  const { data: existing, error: selectError } = await supabase
    .from('evidence')
    .select('id, object_path, upload_status, size_bytes')
    .eq('id', evidenceId)
    .maybeSingle<EvidenceRow>();
  if (selectError) throw new EvidenceUploadError('ROW_FAILED', 'Could not save the recording.', evidenceId, true);
  if (existing?.upload_status === 'uploaded') {
    return { evidenceId, objectPath: existing.object_path, sizeBytes: existing.size_bytes ?? 0 };
  }
  if (!existing) {
    const { error: insertError } = await supabase.from('evidence').insert({
      id: evidenceId,
      organization_id: profile.organization_id,
      incident_revision_id: revisionId,
      object_path: objectPath,
      media_type: mediaType,
      upload_status: 'pending',
      uploaded_by: user.id,
      capture_time: new Date().toISOString(),
    });
    // 23505 = a previous attempt inserted the row but its response was lost; carry on with it.
    if (insertError && insertError.code !== '23505') {
      throw new EvidenceUploadError('ROW_FAILED', 'Could not save the recording.', evidenceId, true);
    }
  }

  // 2. File → storage. Never upload something that is not the real file (e.g. a "File not found" error body).
  let body: Uint8Array;
  try {
    body = await readLocalFile(uri, mediaType);
  } catch (error) {
    await markFailed(evidenceId);
    const detail = error instanceof LocalFileError ? ` (${error.detail})` : '';
    throw new EvidenceUploadError('FILE_READ_FAILED', `Could not read the ${mediaType === 'audio' ? 'recording' : 'photo'} on this phone${detail}.`, evidenceId, false);
  }

  // Send an exact ArrayBuffer (not a view that may sit inside a larger buffer) so RN's networking layer sends
  // precisely these bytes.
  const sizeBytes = body.byteLength;
  const payload = body.buffer.slice(body.byteOffset, body.byteOffset + sizeBytes) as ArrayBuffer;
  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(objectPath, payload, { contentType, upsert: true });
  if (uploadError) {
    await markFailed(evidenceId);
    throw new EvidenceUploadError('UPLOAD_FAILED', 'Upload failed. Check your connection and try again.', evidenceId, true);
  }

  // Verify what Storage holds is what we read. A mismatch means the bytes were altered in transit.
  // If the info call itself fails we do not block: the upload already succeeded and the server sniffs the bytes.
  const { data: stored } = await supabase.storage.from(EVIDENCE_BUCKET).info(objectPath);
  if (stored && typeof stored.size === 'number' && stored.size !== sizeBytes) {
    await markFailed(evidenceId);
    throw new EvidenceUploadError(
      'UPLOAD_FAILED',
      `Upload was corrupted (stored ${stored.size} bytes, expected ${sizeBytes}). Try again.`,
      evidenceId,
      true,
    );
  }

  // 3. Mark uploaded.
  const { error: updateError } = await supabase
    .from('evidence')
    .update({ upload_status: 'uploaded', size_bytes: sizeBytes > 0 ? sizeBytes : null })
    .eq('id', evidenceId);
  if (updateError) {
    throw new EvidenceUploadError('ROW_FAILED', 'Upload finished but could not be confirmed. Try again.', evidenceId, true);
  }

  return { evidenceId, objectPath, sizeBytes };
}
