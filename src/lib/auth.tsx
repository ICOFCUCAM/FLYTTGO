import { ReactNode } from "react";
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabase';

interface UserProfile {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: 'customer' | 'driver' | 'admin';
  phone?: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: any;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, firstName: string, lastName: string, role: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data: profileData, error } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
      if (error) { console.error('Profile fetch error:', error); return; }
      const { data: adminData } = await supabase.from('admin_accounts').select('*').eq('user_id', userId).maybeSingle();
      const finalProfile = adminData ? { ...profileData, role: 'admin' } : profileData;
      setProfile(finalProfile as UserProfile);
    } catch (e) {
      console.error('Error fetching profile:', e);
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email: string, password: string, firstName: string, lastName: string, role: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    if (data.user) {
      const refCode = 'FLYTTGO-' + data.user.id.slice(0, 8).toUpperCase();
      await supabase.from('profiles').insert({ user_id: data.user.id, email, first_name: firstName, last_name: lastName, role, referral_code: refCode });
      if (role === 'driver') await supabase.from('drivers').insert({ user_id: data.user.id, status: 'pending', subscription_plan: 'Free' });
    }
    return { error: null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

export function AuthProvider({ children }: { children: React.ReactNode }) {

  async function updateProfile(data: Partial<UserProfile>) {
    if (!user) return;
    await supabase.from('profiles').update(data).eq('user_id', user.id);
    setProfile(prev => (prev ? { ...prev, ...data } : null));
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
