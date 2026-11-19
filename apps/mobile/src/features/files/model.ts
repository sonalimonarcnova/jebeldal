import { z } from 'zod';

export const documentFileCategories = [
  'cdl_front',
  'cdl_back',
  'medical_card',
  'registration',
  'insurance_card',
] as const;

export const setupDocumentCategories = [
  'cdl_front',
  'cdl_back',
  'medical_card',
  'registration',
] as const;

export const walkaroundPhotoCategories = [
  'walkaround_front',
  'walkaround_driver_side',
  'walkaround_rear',
  'walkaround_passenger_side',
] as const;

export const driverFileCategorySchema = z.enum([
  ...documentFileCategories,
  ...walkaroundPhotoCategories,
]);

export type DriverFileCategory = z.infer<typeof driverFileCategorySchema>;
export type DriverFile = {
  id: string;
  category: DriverFileCategory;
  objectPath: string;
  mediaType: 'image' | 'document';
  sizeBytes: number | null;
  capturedAt: string | null;
  uploadStatus: 'pending' | 'uploaded' | 'failed';
  createdAt: string;
};

const driverFileRowSchema = z.object({
  id: z.string().uuid(),
  category: driverFileCategorySchema,
  object_path: z.string().min(1),
  media_type: z.enum(['image', 'document']),
  size_bytes: z.number().int().positive().nullable(),
  captured_at: z.string().nullable(),
  upload_status: z.enum(['pending', 'uploaded', 'failed']),
  created_at: z.string().datetime({ offset: true }),
});

export function mapDriverFiles(rawFiles: unknown): DriverFile[] {
  const parsed = z.array(driverFileRowSchema).safeParse(rawFiles);
  if (!parsed.success) {
    throw new Error('The driver files returned by Supabase are invalid.');
  }

  return parsed.data.map((file) => ({
    id: file.id,
    category: file.category,
    objectPath: file.object_path,
    mediaType: file.media_type,
    sizeBytes: file.size_bytes,
    capturedAt: file.captured_at,
    uploadStatus: file.upload_status,
    createdAt: file.created_at,
  }));
}

export function countUploadedCategories(
  files: DriverFile[],
  categories: readonly DriverFileCategory[],
): number {
  const uploaded = new Set(
    files.filter((file) => file.uploadStatus === 'uploaded').map((file) => file.category),
  );
  return categories.filter((category) => uploaded.has(category)).length;
}

export function driverFileCategoryLabel(category: DriverFileCategory): string {
  switch (category) {
    case 'cdl_front':
      return 'License — front';
    case 'cdl_back':
      return 'License — back';
    case 'medical_card':
      return 'Medical card';
    case 'registration':
      return 'Vehicle registration';
    case 'insurance_card':
      return 'Insurance card';
    case 'walkaround_front':
      return 'Front';
    case 'walkaround_driver_side':
      return 'Driver side';
    case 'walkaround_rear':
      return 'Rear';
    case 'walkaround_passenger_side':
      return 'Passenger side';
  }
}
