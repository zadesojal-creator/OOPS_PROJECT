import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
} from '@firebase/auth';
import { auth } from '../services/firebase';
import { get } from '../services/api';
import type { UserProfile } from '../types';

type Ctx = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  reset: (email: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  async function loadProfile() {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setProfile(null);
      setAuthError('');
      return;
    }
    try {
      const result = await get<UserProfile>('/me');
      if (auth.currentUser?.uid !== currentUser.uid) return;
      if (
        !result.uid ||
        !['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(result.role)
      ) {
        throw new Error('Your account has no assigned clinic role.');
      }
      setProfile(result);
      setAuthError('');
    } catch (error) {
      if (auth.currentUser?.uid !== currentUser.uid) throw error;
      setProfile(null);
      setAuthError(
        error instanceof Error ? error.message : 'Unable to load your clinic role.',
      );
      throw error;
    }
  }

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;
      setLoading(true);
      setUser(currentUser);
      setProfile(null);
      setAuthError('');
      try {
        if (currentUser) await loadProfile();
      } catch {
        // The visible authError state offers a retry and sign-out action.
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function login(email: string, password: string, remember: boolean) {
    await setPersistence(
      auth,
      remember ? browserLocalPersistence : browserSessionPersistence,
    );
    await signInWithEmailAndPassword(auth, email, password);
  }

  return (
    <AuthCtx.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        login,
        logout: () => signOut(auth),
        reset: (email) => sendPasswordResetEmail(auth, email),
        reloadProfile: loadProfile,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthCtx);
  if (!context) throw new Error('AuthProvider missing');
  return context;
};
