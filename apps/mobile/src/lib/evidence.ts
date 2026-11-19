// Evidence upload through Eng B's RPCs (tables are read-only to drivers):
//   read + check the local file → rpc create_incident_evidence (row + object path) → upload bytes to that path
//   → verify stored size → rpc finalize_incident_evidence (server re-checks size + MIME). docs/voice-integration.md
import { File } from 'expo-file-system';

import { supabase } from './supabase';

export const EVIDENCE_BUCKET = 'incident-evidence';

export type EvidenceMediaType = 'audio' | 'photo';

const CONTENT_TYPE: Record<EvidenceMediaType, string> = {
  audio: 'audio/mp4', // m4a (MPEG-4 + AAC)
  photo: 'image/jpeg',
};

export type EvidenceErrorCode =
  | 'NOT_SIGNED_IN'
  | 'NOT_ALLOWED'
  | 'INCIDENT_NOT_DRAFT'
  | 'FILE_READ_FAILED'
  | 'ROW_FAILED'
  | 'UPLOAD_FAILED'
  | 'EVIDENCE_INVALID';

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
  /** Stored as the evidence description (create_incident_evidence has no question_key column). */
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

/** Recorder/picker URIs are sometimes bare absolute paths; File needs a file:// URL for those. */
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

/** Reads the local recording/photo with expo-file-system (fetch() on file:// URIs is unreliable on devices). */
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

/** Eng B's RPCs raise errcode P0001 with the reason in `message`. */
function rpcError(error: { code?: string; message?: string }, evidenceId: string | null): EvidenceUploadError {
  const reason = error.code === 'P0001' ? error.message : undefined;
  if (reason === 'AUTH_REQUIRED') return new EvidenceUploadError('NOT_SIGNED_IN', 'Sign in again to upload.', evidenceId, false);
  if (reason === 'NOT_ALLOWED') {
    return new EvidenceUploadError('NOT_ALLOWED', 'This report cannot take new evidence.', evidenceId, false);
  }
  if (reason === 'VALIDATION_FAILED') {
    return new EvidenceUploadError('ROW_FAILED', 'The file is too large or not allowed.', evidenceId, false);
  }
  return new EvidenceUploadError('ROW_FAILED', 'Could not save the recording. Try again.', evidenceId, true);
}

/** Existing row for a retry (evidence is SELECT-only for drivers). */
async function existingEvidence(evidenceId: string): Promise<EvidenceRow | null> {
  const { data, error } = await supabase
    .from('evidence')
    .select('id, object_path, upload_status, size_bytes')
    .eq('id', evidenceId)
    .maybeSingle<EvidenceRow>();
  if (error) throw new EvidenceUploadError('ROW_FAILED', 'Could not save the recording. Try again.', evidenceId, true);
  return data;
}

/**
 * Idempotent per evidenceId: on retry the existing row and path are reused, and an already-uploaded one is returned.
 * A file read failure happens before any row exists, so it never leaves an orphan pending row.
 */
export async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadedEvidence> {
  const { revisionId, uri, mediaType } = input;
  const contentType = CONTENT_TYPE[mediaType];

  // 1. Read + check the local file (also gives the size create_incident_evidence needs).
  let body: Uint8Array;
  try {
    body = await readLocalFile(uri, mediaType);
  } catch (error) {
    const detail = error instanceof LocalFileError ? ` (${error.detail})` : '';
    throw new EvidenceUploadError(
      'FILE_READ_FAILED',
      `Could not read the ${mediaType === 'audio' ? 'recording' : 'photo'} on this phone${detail}.`,
      input.evidenceId ?? null,
      false,
    );
  }
  const sizeBytes = body.byteLength;

  // 2. Row: reuse on retry, otherwise create via RPC (server builds the {org}/{revision}/{evidence} path).
  let evidenceId: string;
  let objectPath: string;
  const prior = input.evidenceId ? await existingEvidence(input.evidenceId) : null;
  if (prior) {
    if (prior.upload_status === 'uploaded') return { evidenceId: prior.id, objectPath: prior.object_path, sizeBytes: prior.size_bytes ?? 0 };
    if (prior.size_bytes !== null && prior.size_bytes !== sizeBytes) {
      // finalize compares against the size given at creation, so a different file needs a new row.
      throw new EvidenceUploadError('UPLOAD_FAILED', 'The recording changed since the first attempt. Record again.', prior.id, false);
    }
    evidenceId = prior.id;
    objectPath = prior.object_path;
  } else {
    const { data, error } = await supabase.rpc('create_incident_evidence', {
      p_incident_revision_id: revisionId,
      p_media_type: mediaType,
      p_size_bytes: sizeBytes,
      p_description: input.questionKey ?? null,
    });
    if (error) throw rpcError(error, null);
    const created = data as { evidence_id?: unknown; object_path?: unknown } | null;
    if (typeof created?.evidence_id !== 'string' || typeof created.object_path !== 'string') {
      throw new EvidenceUploadError('ROW_FAILED', 'Unexpected reply when saving the recording.', null, true);
    }
    evidenceId = created.evidence_id;
    objectPath = created.object_path;
  }

  // 3. Upload an exact ArrayBuffer (not a view inside a larger buffer) to the server-chosen path.
  const payload = body.buffer.slice(body.byteOffset, body.byteOffset + sizeBytes) as ArrayBuffer;
  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(objectPath, payload, { contentType, upsert: true });
  if (uploadError) {
    throw new EvidenceUploadError('UPLOAD_FAILED', 'Upload failed. Check your connection and try again.', evidenceId, true);
  }

  // 4. Verify what Storage holds is what we read (finalize checks this too; this gives a clearer error).
  const { data: stored } = await supabase.storage.from(EVIDENCE_BUCKET).info(objectPath);
  if (stored && typeof stored.size === 'number' && stored.size !== sizeBytes) {
    throw new EvidenceUploadError(
      'UPLOAD_FAILED',
      `Upload was corrupted (stored ${stored.size} bytes, expected ${sizeBytes}). Try again.`,
      evidenceId,
      true,
    );
  }

  // 5. Finalize: the server re-checks size + MIME and marks the row uploaded (or failed).
  const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_incident_evidence', { p_evidence_id: evidenceId });
  if (finalizeError) throw rpcError(finalizeError, evidenceId);
  const result = finalized as { upload_status?: unknown; code?: unknown } | null;
  if (result?.upload_status !== 'uploaded') {
    throw new EvidenceUploadError(
      'EVIDENCE_INVALID',
      'The server rejected the file (size or type mismatch). Try again.',
      evidenceId,
      true,
    );
  }

  return { evidenceId, objectPath, sizeBytes };
}
