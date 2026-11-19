import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import {
  driverFileCategorySchema,
  mapDriverFiles,
  type DriverFile,
  type DriverFileCategory,
} from './model';

const maxFileSizeBytes = 50 * 1024 * 1024;
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const preparedFileSchema = z.object({
  user_file_id: z.string().uuid(),
  object_path: z.string().min(1),
  category: driverFileCategorySchema,
  media_type: z.enum(['image', 'document']),
  size_bytes: z.number().int().positive().max(maxFileSizeBytes),
  upload_status: z.literal('pending'),
});

const finalizedFileSchema = z.object({
  user_file_id: z.string().uuid(),
  upload_status: z.enum(['uploaded', 'failed']),
  reason: z.string().optional(),
});

export type SelectedDriverFile = {
  uri: string;
  name: string;
  mimeType: string | null;
};

export type PendingDriverFile = {
  id: string;
  objectPath: string;
  category: DriverFileCategory;
  mediaType: 'image' | 'document';
  contentType: string;
  blob: Blob;
};

type ValidatedDriverAsset = {
  blob: Blob;
  mediaType: 'image' | 'document';
  contentType: string;
};

function isWalkaroundCategory(category: DriverFileCategory): boolean {
  return category.startsWith('walkaround_');
}

function fileExtensionMimeType(name: string): string | null {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function validateDriverAsset(
  category: DriverFileCategory,
  asset: SelectedDriverFile,
): Promise<ValidatedDriverAsset> {
  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new Error('The selected file could not be read from this device.');
  }
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size > maxFileSizeBytes) {
    throw new Error('Files must be between 1 byte and 50 MB.');
  }

  const allowedTypes = isWalkaroundCategory(category)
    ? imageMimeTypes
    : new Set(['application/pdf']);
  const contentType = [asset.mimeType, blob.type, fileExtensionMimeType(asset.name)]
    .map((type) => type?.split(';', 1)[0].trim().toLocaleLowerCase('en'))
    .find((type): type is string => Boolean(type && allowedTypes.has(type)));
  if (!contentType) {
    throw new Error(
      isWalkaroundCategory(category)
        ? 'Choose a JPEG, PNG, or WebP image.'
        : 'Choose a PDF document.',
    );
  }

  return {
    blob,
    mediaType: isWalkaroundCategory(category) ? 'image' : 'document',
    contentType,
  };
}

export async function loadDriverFiles(): Promise<DriverFile[]> {
  const { data, error } = await supabase
    .from('user_files')
    .select('id,category,object_path,media_type,size_bytes,captured_at,upload_status,created_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Could not load your files: ${error.message}`);
  }
  return mapDriverFiles(data);
}

export async function prepareDriverFile(
  category: DriverFileCategory,
  asset: SelectedDriverFile,
): Promise<PendingDriverFile> {
  const validated = await validateDriverAsset(category, asset);
  const { data, error } = await supabase.rpc('create_user_file', {
    p_category: category,
    p_media_type: validated.mediaType,
    p_size_bytes: validated.blob.size,
    p_captured_at: validated.mediaType === 'image' ? new Date().toISOString() : null,
    p_location: null,
  });
  if (error) {
    throw new Error(`Could not prepare the file upload: ${error.message}`);
  }
  const prepared = preparedFileSchema.safeParse(data);
  if (
    !prepared.success
    || prepared.data.category !== category
    || prepared.data.media_type !== validated.mediaType
  ) {
    throw new Error('The server returned invalid file upload details.');
  }

  return {
    id: prepared.data.user_file_id,
    objectPath: prepared.data.object_path,
    category,
    mediaType: validated.mediaType,
    contentType: validated.contentType,
    blob: validated.blob,
  };
}

export async function prepareDriverFileRetry(
  file: DriverFile,
  asset: SelectedDriverFile,
): Promise<PendingDriverFile> {
  const validated = await validateDriverAsset(file.category, asset);
  if (file.sizeBytes !== validated.blob.size || file.mediaType !== validated.mediaType) {
    throw new Error('Choose the same file that was selected for the original upload.');
  }

  return {
    id: file.id,
    objectPath: file.objectPath,
    category: file.category,
    mediaType: file.mediaType,
    contentType: validated.contentType,
    blob: validated.blob,
  };
}

export async function uploadPendingDriverFile(file: PendingDriverFile): Promise<void> {
  const { error: uploadError } = await supabase.storage
    .from('driver-files')
    .upload(file.objectPath, file.blob, {
      contentType: file.contentType,
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`File upload failed: ${uploadError.message}`);
  }

  const { data, error } = await supabase.rpc('finalize_user_file', {
    p_user_file_id: file.id,
  });
  if (error) {
    throw new Error(`Could not verify the uploaded file: ${error.message}`);
  }
  const finalized = finalizedFileSchema.safeParse(data);
  if (!finalized.success || finalized.data.user_file_id !== file.id) {
    throw new Error('The server returned invalid file verification details.');
  }
  if (finalized.data.upload_status !== 'uploaded') {
    throw new Error(
      finalized.data.reason
        ? `The server could not verify this file (${finalized.data.reason}).`
        : 'The server could not verify this file.',
    );
  }
}

export async function createDriverFileUrl(objectPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('driver-files')
    .createSignedUrl(objectPath, 60);
  if (error) {
    throw new Error(`Could not open this file: ${error.message}`);
  }
  if (!data?.signedUrl) {
    throw new Error('The server did not return a file link.');
  }
  return data.signedUrl;
}

export function describeFileError(error: unknown, fallback: string): string {
  return errorMessage(error, fallback);
}
