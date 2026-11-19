import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '../lib/supabase';
import {
  completeDriverProfile,
  loadDriverProfile,
  updateDriverProfile,
  type DriverProfile,
  type EditableDriverProfile,
} from './profileRepository';

type AuthContextValue = {
  session: Session | null;
  profile: DriverProfile | null;
  authLoading: boolean;
  profileLoading: boolean;
  authError: string | null;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<boolean>;
  confirmProfile: (profile: EditableDriverProfile) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected authentication error occurred.';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) {
          setAuthError(`Could not restore sign-in: ${error.message}`);
          return;
        }
        setProfileLoading(Boolean(data.session));
        setSession(data.session);
      } catch (error) {
        if (active) {
          setAuthError(errorMessage(error));
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };

    void restoreSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setProfile(null);
      setProfileError(null);
      setProfileLoading(Boolean(nextSession));
      setSession(nextSession);
      setAuthError(null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async (): Promise<boolean> => {
    const userId = session?.user.id;
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return true;
    }

    setProfileLoading(true);
    setProfileError(null);
    try {
      const nextProfile = await loadDriverProfile(userId);
      setProfile(nextProfile);
      return true;
    } catch (error) {
      setProfile(null);
      setProfileError(errorMessage(error));
      return false;
    } finally {
      setProfileLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(`Could not sign out: ${error.message}`);
    }
  }, []);

  const confirmProfile = useCallback(
    async (editableProfile: EditableDriverProfile) => {
      const userId = session?.user.id;
      if (!userId) {
        throw new Error('Sign in before confirming a driver profile.');
      }

      await updateDriverProfile(userId, editableProfile);
      await completeDriverProfile();
      const refreshed = await refreshProfile();
      if (!refreshed) {
        throw new Error('Profile was saved, but the updated profile could not be reloaded.');
      }
    },
    [refreshProfile, session?.user.id],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      authLoading,
      profileLoading,
      authError,
      profileError,
      signIn,
      signOut,
      refreshProfile,
      confirmProfile,
    }),
    [
      session,
      profile,
      authLoading,
      profileLoading,
      authError,
      profileError,
      signIn,
      signOut,
      refreshProfile,
      confirmProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return value;
}
