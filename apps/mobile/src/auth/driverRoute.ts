import type { DriverProfile } from './profileRepository';

export type DriverRouteState =
  | 'loading'
  | 'auth-error'
  | 'sign-in'
  | 'profile-error'
  | 'missing-profile'
  | 'not-driver'
  | 'confirm-profile'
  | 'home';

export function resolveDriverRoute(input: {
  authLoading: boolean;
  hasSession: boolean;
  profileLoading: boolean;
  authError: string | null;
  profileError: string | null;
  profile: DriverProfile | null;
}): DriverRouteState {
  if (input.authLoading || (input.hasSession && input.profileLoading)) {
    return 'loading';
  }
  if (input.authError) {
    return 'auth-error';
  }
  if (!input.hasSession) {
    return 'sign-in';
  }
  if (input.profileError) {
    return 'profile-error';
  }
  if (!input.profile) {
    return 'missing-profile';
  }
  if (input.profile.role !== 'driver') {
    return 'not-driver';
  }
  if (!input.profile.profileCompletedAt) {
    return 'confirm-profile';
  }
  return 'home';
}
