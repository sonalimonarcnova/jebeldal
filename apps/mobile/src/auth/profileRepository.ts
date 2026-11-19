import { z } from 'zod';

import { supabase } from '../lib/supabase';

const profileRowSchema = z.object({
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  role: z.string(),
  display_name: z.string(),
  phone: z.string().nullable(),
  employee_id: z.string().nullable(),
  assigned_vehicle_id: z.string().uuid().nullable(),
  preferred_language: z.string(),
  profile_completed_at: z.string().nullable(),
});

const vehicleSchema = z.object({
  id: z.string().uuid(),
  unit_number: z.string(),
  plate: z.string().nullable(),
  make_model: z.string().nullable(),
});

const organizationSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
});

export type DriverProfile = {
  userId: string;
  organizationId: string;
  role: string;
  displayName: string;
  phone: string;
  employeeId: string;
  preferredLanguage: string;
  profileCompletedAt: string | null;
  vehicle: {
    unitNumber: string;
    plate: string | null;
    makeModel: string | null;
  } | null;
  organizationName: string;
};

export type EditableDriverProfile = {
  displayName: string;
  phone: string;
  preferredLanguage: 'en' | 'es';
};

export async function loadDriverProfile(userId: string): Promise<DriverProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'user_id,organization_id,role,display_name,phone,employee_id,assigned_vehicle_id,preferred_language,profile_completed_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load driver profile: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const profileResult = profileRowSchema.safeParse(data);
  if (!profileResult.success) {
    throw new Error('The driver profile returned by Supabase is invalid.');
  }
  const profile = profileResult.data;

  let vehicle: DriverProfile['vehicle'] = null;
  if (profile.assigned_vehicle_id) {
    const vehicleResponse = await supabase
      .from('vehicles')
      .select('id,unit_number,plate,make_model')
      .eq('id', profile.assigned_vehicle_id)
      .maybeSingle();

    if (vehicleResponse.error) {
      throw new Error(`Could not load assigned vehicle: ${vehicleResponse.error.message}`);
    }
    if (!vehicleResponse.data) {
      throw new Error('The assigned vehicle is not available to this driver.');
    }

    const vehicleResult = vehicleSchema.safeParse(vehicleResponse.data);
    if (!vehicleResult.success) {
      throw new Error('The assigned vehicle returned by Supabase is invalid.');
    }
    vehicle = {
      unitNumber: vehicleResult.data.unit_number,
      plate: vehicleResult.data.plate,
      makeModel: vehicleResult.data.make_model,
    };
  }

  const organizationResponse = await supabase
    .from('organizations')
    .select('id,display_name')
    .eq('id', profile.organization_id)
    .maybeSingle();

  if (organizationResponse.error) {
    throw new Error(`Could not load organization profile: ${organizationResponse.error.message}`);
  }
  if (!organizationResponse.data) {
    throw new Error('The driver organization is not available to this account.');
  }

  const organizationResult = organizationSchema.safeParse(organizationResponse.data);
  if (!organizationResult.success) {
    throw new Error('The organization returned by Supabase is invalid.');
  }

  return {
    userId: profile.user_id,
    organizationId: profile.organization_id,
    role: profile.role,
    displayName: profile.display_name,
    phone: profile.phone ?? '',
    employeeId: profile.employee_id ?? '',
    preferredLanguage: profile.preferred_language,
    profileCompletedAt: profile.profile_completed_at,
    vehicle,
    organizationName: organizationResult.data.display_name,
  };
}

export async function updateDriverProfile(
  userId: string,
  profile: EditableDriverProfile,
): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: profile.displayName.trim(),
      phone: profile.phone.trim() || null,
      preferred_language: profile.preferredLanguage,
    })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();

  if (error) {
    throw new Error(`Could not save driver profile: ${error.message}`);
  }
  if (!data) {
    throw new Error('The signed-in driver profile was not updated.');
  }
}

export async function completeDriverProfile(): Promise<string> {
  const { data, error } = await supabase.rpc('complete_driver_profile');
  if (error) {
    throw new Error(`Could not confirm driver profile: ${error.message}`);
  }
  if (typeof data !== 'string') {
    throw new Error('Profile completion did not return a confirmation timestamp.');
  }
  return data;
}
