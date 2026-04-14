import React, { useState, useEffect } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { X, Eye, EyeOff, ArrowRight, ArrowLeft } from 'lucide-react';

type Role = 'customer' | 'driver' | 'business';

const ROLE_OPTIONS: { id: Role; title: string; desc: string; icon: string }[] = [
  { id: 'customer', title: 'Personal',  desc: 'Book moves and deliveries for yourself', icon: '🏠' },
  { id: 'driver',   title: 'Driver',    desc: 'Earn money with your van',               icon: '🚐' },
  { id: 'business', title: 'Business',  desc: 'Corporate logistics at scale',           icon: '🏢' },
];

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.41-1.09-.47-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.41C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
}

export default function AuthModal() {
  const { showAuthModal, setShowAuthModal, authMode, setAuthMode } = useApp();
  const { signIn, signUp, signInWithGoogle, signInWithApple, resetPassword } = useAuth();

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Sign up flow: first pick a role, then fill in the form.
  const [signupStep, setSignupStep]   = useState<'choose' | 'form'>('choose');
  const [selectedRole, setSelectedRole] = useState<Role>('customer');

  // Forgot password sub-flow (lives under the 'signin' auth mode).
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent]   = useState(false);

  // Reset transient state every time the modal is (re-)opened.
  useEffect(() => {
    if (showAuthModal) {
      setError('');
      setLoading(false);
      setShowPass(false);
      setSignupStep('choose');
      setForgotMode(false);
      setResetSent(false);
    }
  }, [showAuthModal, authMode]);

  if (!showAuthModal) return null;

  const isSignIn = authMode === 'signin';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignIn) {
        const { error } = await signIn(email, password);
        if (error) { setError(error.message); return; }
      } else {
        const { error } = await signUp(email, password, firstName, lastName, selectedRole);
        if (error) { setError(error.message); return; }
      }
      setShowAuthModal(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: 'google' | 'apple') {
    setError('');
    setLoading(true);
    try {
      const { error } = provider === 'google'
        ? await signInWithGoogle()
        : await signInWithApple();
      if (error) setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await resetPassword(email);
      if (error) { setError(error.message); return; }
      setResetSent(true);
    } finally {
      setLoading(false);
    }
  }

  const fieldCls =
    'w-full px-4 py-3 bg-[#1E293B] border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition';

  const gradientBtnCls =
    'w-full py-3 bg-gradient-to-r from-cyan-400 via-sky-500 to-purple-500 text-white rounded-xl font-semibold hover:from-cyan-500 hover:via-sky-600 hover:to-purple-600 transition disabled:opacity-60 shadow-lg shadow-cyan-500/10';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0B1220] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-8 relative text-white">
        <button
          onClick={() => setShowAuthModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ══════════ SIGN IN ══════════ */}
        {isSignIn && !forgotMode && (
          <>
            <h2 className="text-2xl font-bold mb-1">Sign In</h2>
            <p className="text-gray-400 text-sm mb-6">Welcome back to FlyttGo.</p>

            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-white text-gray-900 rounded-xl font-semibold mb-3 hover:bg-gray-100 transition disabled:opacity-60"
            >
              <GoogleIcon /> Sign in with Google
            </button>

            <button
              type="button"
              onClick={() => handleOAuth('apple')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-black text-white border border-white/10 rounded-xl font-semibold hover:bg-gray-900 transition disabled:opacity-60"
            >
              <AppleIcon /> Sign in with Apple
            </button>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-gray-500">or continue with email</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {error && (
              <div className="bg-red-950/50 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className={fieldCls}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-300">Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError(''); setResetSent(false); }}
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className={`${fieldCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className={gradientBtnCls}>
                {loading ? 'Please wait…' : 'Sign In'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signup'); setError(''); setSignupStep('choose'); }}
                className="text-cyan-400 font-semibold hover:underline"
              >
                Sign Up
              </button>
            </p>
          </>
        )}

        {/* ══════════ FORGOT PASSWORD ══════════ */}
        {isSignIn && forgotMode && (
          <>
            <button
              type="button"
              onClick={() => { setForgotMode(false); setError(''); setResetSent(false); }}
              className="flex items-center gap-1 text-gray-400 hover:text-white mb-4 text-sm transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </button>

            <h2 className="text-2xl font-bold mb-1">Reset password</h2>
            <p className="text-gray-400 text-sm mb-6">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            {error && (
              <div className="bg-red-950/50 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm mb-4">
                {error}
              </div>
            )}

            {resetSent ? (
              <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 rounded-xl p-4 text-sm">
                <p className="font-semibold mb-1">Check your inbox</p>
                <p className="text-emerald-300/80">
                  If an account exists for <span className="font-mono">{email}</span>, a reset link is on its way.
                </p>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className={fieldCls}
                  />
                </div>
                <button type="submit" disabled={loading} className={gradientBtnCls}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
          </>
        )}

        {/* ══════════ SIGN UP — ROLE CHOOSER ══════════ */}
        {!isSignIn && signupStep === 'choose' && (
          <>
            <h2 className="text-2xl font-bold mb-1">Create Account</h2>
            <p className="text-gray-400 text-sm mb-6">Choose your account type to get started.</p>

            <div className="space-y-3">
              {ROLE_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => { setSelectedRole(option.id); setSignupStep('form'); setError(''); }}
                  className="w-full flex items-center gap-4 p-4 bg-[#1E293B] border border-white/10 rounded-xl text-left hover:border-cyan-500/60 hover:bg-[#1E293B]/80 transition group"
                >
                  <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center text-xl flex-shrink-0 group-hover:bg-cyan-500/20 transition">
                    {option.icon}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-white">{option.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{option.desc}</div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-500 group-hover:text-cyan-400 flex-shrink-0 transition" />
                </button>
              ))}
            </div>

            <p className="text-center text-sm text-gray-400 mt-6">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signin'); setError(''); }}
                className="text-cyan-400 font-semibold hover:underline"
              >
                Sign In
              </button>
            </p>
          </>
        )}

        {/* ══════════ SIGN UP — FORM ══════════ */}
        {!isSignIn && signupStep === 'form' && (
          <>
            <button
              type="button"
              onClick={() => { setSignupStep('choose'); setError(''); }}
              className="flex items-center gap-1 text-gray-400 hover:text-white mb-4 text-sm transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <h2 className="text-2xl font-bold mb-1">Create Account</h2>
            <p className="text-gray-400 text-sm mb-6">
              {selectedRole === 'customer' && 'Join as a personal customer.'}
              {selectedRole === 'driver'   && 'Start earning with FlyttGo.'}
              {selectedRole === 'business' && 'Set up your corporate account.'}
            </p>

            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-white text-gray-900 rounded-xl font-semibold mb-3 hover:bg-gray-100 transition disabled:opacity-60"
            >
              <GoogleIcon /> Continue with Google
            </button>

            <button
              type="button"
              onClick={() => handleOAuth('apple')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-black text-white border border-white/10 rounded-xl font-semibold hover:bg-gray-900 transition disabled:opacity-60"
            >
              <AppleIcon /> Continue with Apple
            </button>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-gray-500">or continue with email</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {error && (
              <div className="bg-red-950/50 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">First name</label>
                  <input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                    placeholder="Jane"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Last name</label>
                  <input
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    required
                    placeholder="Doe"
                    className={fieldCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className={fieldCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className={`${fieldCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className={gradientBtnCls}>
                {loading ? 'Please wait…' : 'Create Account'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signin'); setError(''); }}
                className="text-cyan-400 font-semibold hover:underline"
              >
                Sign In
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
