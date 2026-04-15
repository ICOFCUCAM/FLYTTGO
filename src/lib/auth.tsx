import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode
} from "react";
import { supabase } from "./supabase";

/* ================= TYPES ================= */

interface UserProfile {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: "customer" | "driver" | "business" | "admin";
  phone?: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: any;
  profile: UserProfile | null;
  loading: boolean;

  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    role: string
  ) => Promise<{ error: any }>;

  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: any }>;

  signInWithGoogle: () => Promise<{ error: any }>;
  signInWithApple: () => Promise<{ error: any }>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  resendConfirmation: (email: string) => Promise<{ error: any }>;

  signOut: () => Promise<void>;

  updateProfile: (
    data: Partial<UserProfile>
  ) => Promise<void>;
}

/* ================= CONTEXT ================= */

const AuthContext =
  createContext<AuthContextType | undefined>(
    undefined
  );

/* ================= PROVIDER ================= */

export function AuthProvider({
  children
}: {
  children: ReactNode;
}) {
  const [user, setUser] =
    useState<any>(null);

  const [profile, setProfile] =
    useState<UserProfile | null>(null);

  const [loading, setLoading] =
    useState(true);

/* ================= PROFILE FETCH ================= */

  async function fetchProfile(
    userId: string
  ) {
    try {
      const {
        data: profileData,
        error
      } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        console.error(
          "Profile fetch error:",
          error
        );
        return;
      }

      const {
        data: adminData
      } = await supabase
        .from("admin_accounts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      const finalProfile =
        adminData
          ? {
              ...profileData,
              role: "admin"
            }
          : profileData;

      setProfile(
        finalProfile as UserProfile
      );
    } catch (e) {
      console.error(
        "Error fetching profile:",
        e
      );
    } finally {
      setLoading(false);
    }
  }

/* ================= AUTH STATE ================= */

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(
        ({ data: { session } }) => {
          setUser(
            session?.user ?? null
          );

          if (session?.user) {
            fetchProfile(
              session.user.id
            );
          } else {
            setLoading(false);
          }
        }
      );

    const {
      data: { subscription }
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setUser(
            session?.user ?? null
          );

          if (session?.user) {
            fetchProfile(
              session.user.id
            );
          } else {
            setProfile(null);
            setLoading(false);
          }
        }
      );

    return () =>
      subscription.unsubscribe();
  }, []);

/* ================= SIGNUP =================
 *
 * The `emailRedirectTo` option is what makes email confirmation work
 * end-to-end: Supabase substitutes this URL into the {{ .ConfirmationURL }}
 * placeholder in the confirmation-email template, so when the user clicks
 * the link in their inbox they land on /auth/callback in our SPA. The
 * callback page then waits for `detectSessionInUrl` (set in supabase.ts)
 * to pick up the access_token / refresh_token from the URL hash and
 * routes the freshly-confirmed user to their dashboard.
 *
 * We default to `window.location.origin` so this works against both the
 * Vercel preview deploy (https://flyttgo-qo46.vercel.app) and the
 * production domain (https://flyttgo.no) without code changes.
 */

  async function signUp(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    role: string
  ) {
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : "https://flyttgo-qo46.vercel.app/auth/callback";

    const {
      data,
      error
    } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          first_name: firstName,
          last_name:  lastName,
          role
        }
      }
    });

    if (error) return { error };

    if (data.user) {
      const refCode =
        "FLYTTGO-" +
        data.user.id
          .slice(0, 8)
          .toUpperCase();

      await supabase
        .from("profiles")
        .insert({
          user_id: data.user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          referral_code: refCode
        });

      if (role === "driver") {
        await supabase
          .from("drivers")
          .insert({
            user_id: data.user.id,
            status: "pending",
            subscription_plan:
              "Free"
          });
      }
    }

    return { error: null };
  }

/* ================= SIGNIN ================= */

  async function signIn(
    email: string,
    password: string
  ) {
    const { error } =
      await supabase.auth.signInWithPassword(
        {
          email,
          password
        }
      );

    return { error };
  }

async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });

  return { error };
}

async function signInWithApple() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo: window.location.origin,
    },
  });

  return { error };
}

/* ================= SIGNOUT ================= */

  async function signOut() {
    await supabase.auth.signOut();

    setUser(null);
    setProfile(null);
  }

async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  return { error };
}

/* ================= RESEND EMAIL CONFIRMATION =================
 *
 * Wraps supabase.auth.resend() for the 'signup' confirmation email
 * type. AuthModal exposes this as a "Resend confirmation email"
 * button when sign-in fails with the 'email_not_confirmed' code,
 * so customers don't get stuck staring at an error with no path
 * forward when they didn't see / lost the original confirmation
 * email Supabase sent at signup.
 *
 * The redirectTo lands the user back on the booking page so they
 * can continue checking out as soon as their email is verified.
 */
async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type:    'signup',
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/book`,
    },
  });
  return { error };
}

/* ================= UPDATE PROFILE ================= */

  async function updateProfile(
    data: Partial<UserProfile>
  ) {
    if (!user) return;

    await supabase
      .from("profiles")
      .update(data)
      .eq("user_id", user.id);

    setProfile(prev =>
      prev
        ? {
            ...prev,
            ...data
          }
        : null
    );
  }

/* ================= PROVIDER RETURN ================= */

  return (
    <AuthContext.Provider
value={{
  user,
  profile,
  loading,
  signUp,
  signIn,
  signInWithGoogle,
  signInWithApple,
  resetPassword,
  resendConfirmation,
  signOut,
  updateProfile,
}}
>
      {children}
    </AuthContext.Provider>
  );
}

/* ================= HOOK ================= */

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}
