import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { X, Eye, EyeOff, ArrowRight, ArrowLeft, LogIn, KeyRound, UserPlus, Home, Truck, Building2 } from 'lucide-react';

type Role = 'customer' | 'driver' | 'business';

/* Each role's title and desc come from translations at render time
 * so the chooser switches language with the rest of the modal. The
 * Icon component stays static. */
const ROLE_OPTIONS: {
  id: Role;
  titleKey: string;
  descKey: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'customer', titleKey: 'auth.rolePersonal', descKey: 'auth.rolePersonalDesc', Icon: Home },
  { id: 'driver',   titleKey: 'auth.roleDriver',   descKey: 'auth.roleDriverDesc',   Icon: Truck },
  { id: 'business', titleKey: 'auth.roleBusiness', descKey: 'auth.roleBusinessDesc', Icon: Building2 },
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
  const { signIn, signUp, signInWithGoogle, signInWithApple, resetPassword, resendConfirmation } = useAuth();
  const { t } = useTranslation();

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

  /* Email-not-confirmed sub-flow. When sign-in fails because the
   * customer never clicked the Supabase confirmation email link,
   * we flip this on so the inline error banner renders a "Resend
   * confirmation email" button instead of just dead-ending. */
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  // Reset transient state every time the modal is (re-)opened.
  useEffect(() => {
    if (showAuthModal) {
      setError('');
      setLoading(false);
      setShowPass(false);
      setSignupStep('choose');
      setForgotMode(false);
      setResetSent(false);
      setNeedsConfirmation(false);
      setResendingConfirmation(false);
      setConfirmationSent(false);
    }
  }, [showAuthModal, authMode]);

  if (!showAuthModal) return null;

  const isSignIn = authMode === 'signin';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNeedsConfirmation(false);
    setConfirmationSent(false);
    setLoading(true);
    try {
      if (isSignIn) {
        const { error } = await signIn(email, password);
        if (error) {
          /* Detect Supabase's email_not_confirmed error so we can
           * show a "Resend confirmation email" button instead of a
           * dead-end "Email not confirmed" text message. The error
           * code lives at error.code in supabase-js v2; older
           * versions only set the message string, so we fall back
           * to a substring match. */
          const code = (error as any)?.code ?? '';
          const msg  = String(error.message ?? '').toLowerCase();
          if (code === 'email_not_confirmed' || msg.includes('not confirmed') || msg.includes('email not confirmed')) {
            setNeedsConfirmation(true);
            setError('Your email address hasn\u2019t been verified yet. Check your inbox (including spam) for the confirmation link, or resend it below.');
          } else {
            setError(error.message);
          }
          return;
        }
      } else {
        const { error } = await signUp(email, password, firstName, lastName, selectedRole);
        if (error) { setError(error.message); return; }
      }
      setShowAuthModal(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (!email.trim()) {
      setError('Please type your email address above first, then click Resend.');
      return;
    }
    setResendingConfirmation(true);
    setConfirmationSent(false);
    try {
      const { error } = await resendConfirmation(email);
      if (error) {
        setError(`Couldn\u2019t resend the confirmation email: ${error.message}`);
        return;
      }
      setConfirmationSent(true);
      setError('');
    } finally {
      setResendingConfirmation(false);
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
    'w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition';

  const primaryBtnCls =
    'w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition disabled:opacity-60 shadow-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-2xl w-full max-w-md p-8 relative text-gray-900">
        <button
          onClick={() => setShowAuthModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ══════════ SIGN IN ══════════ */}
        {isSignIn && !forgotMode && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                <LogIn className="w-4 h-4 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{t('auth.signInTitle')}</h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">{t('auth.signInWelcome')}</p>

            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold mb-3 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-60 shadow-sm"
            >
              <GoogleIcon /> {t('auth.signInWithGoogle')}
            </button>

            <button
              type="button"
              onClick={() => handleOAuth('apple')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-gray-900 text-white border border-gray-900 rounded-xl font-semibold hover:bg-black transition disabled:opacity-60 shadow-sm"
            >
              <AppleIcon /> {t('auth.signInWithApple')}
            </button>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">{t('auth.orContinueEmail')}</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Error banner. When the cause is an unverified email,
             * we render a "Resend confirmation email" button inside
             * the banner so the customer has a one-click path
             * forward instead of a dead-end. */}
            {error && (
              <div className={`rounded-xl p-3 text-sm mb-4 ${
                needsConfirmation
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                <p className="leading-relaxed">{error}</p>
                {needsConfirmation && !confirmationSent && (
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={resendingConfirmation}
                    className="mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition disabled:opacity-60"
                  >
                    {resendingConfirmation ? 'Sending…' : 'Resend confirmation email'}
                  </button>
                )}
              </div>
            )}

            {/* Successful resend feedback. Separate from the error
             * banner because the resend can succeed AFTER an error,
             * at which point we want the user to see "check your
             * inbox" not the original red error. */}
            {confirmationSent && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm mb-4">
                <p className="font-semibold">Confirmation email sent</p>
                <p className="text-xs mt-1 leading-relaxed">
                  Check your inbox for <strong>{email}</strong> (including the spam folder).
                  Click the link in the email, then come back here and sign in.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email')}</label>
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
                  <label className="block text-sm font-medium text-gray-700">{t('auth.password')}</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError(''); setResetSent(false); }}
                    className="text-xs text-emerald-600 hover:underline font-medium"
                  >
                    {t('auth.forgot')}
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className={primaryBtnCls}>
                {loading ? t('auth.pleaseWait') : t('auth.signInBtn')}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              {t('auth.noAccount')}{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signup'); setError(''); setSignupStep('choose'); }}
                className="text-emerald-600 font-semibold hover:underline"
              >
                {t('header.signUp')}
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
              className="flex items-center gap-1 text-gray-500 hover:text-gray-900 mb-4 text-sm transition"
            >
              <ArrowLeft className="w-4 h-4" /> {t('auth.backToSignIn')}
            </button>

            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{t('auth.resetTitle')}</h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">
              {t('auth.resetIntro')}
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm mb-4">
                {error}
              </div>
            )}

            {resetSent ? (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-sm">
                <p className="font-semibold mb-1">{t('auth.resetSentTitle')}</p>
                <p className="text-emerald-700">
                  {t('auth.resetSentBody1')} <span className="font-mono">{email}</span>, {t('auth.resetSentBody2')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className={fieldCls}
                  />
                </div>
                <button type="submit" disabled={loading} className={primaryBtnCls}>
                  {loading ? t('auth.sending') : t('auth.sendResetLink')}
                </button>
              </form>
            )}
          </>
        )}

        {/* ══════════ SIGN UP — ROLE CHOOSER ══════════ */}
        {!isSignIn && signupStep === 'choose' && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{t('auth.createAccount')}</h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">{t('auth.chooseAccountType')}</p>

            <div className="space-y-3">
              {ROLE_OPTIONS.map(option => {
                const Icon = option.Icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => { setSelectedRole(option.id); setSignupStep('form'); setError(''); }}
                    className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl text-left hover:border-emerald-500 hover:bg-emerald-50/40 transition group"
                  >
                    <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100 transition">
                      <Icon className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{t(option.titleKey)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t(option.descKey)}</div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-emerald-600 flex-shrink-0 transition" />
                  </button>
                );
              })}
            </div>

            <p className="text-center text-sm text-gray-500 mt-6">
              {t('auth.haveAccount')}{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signin'); setError(''); }}
                className="text-emerald-600 font-semibold hover:underline"
              >
                {t('header.signIn')}
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
              className="flex items-center gap-1 text-gray-500 hover:text-gray-900 mb-4 text-sm transition"
            >
              <ArrowLeft className="w-4 h-4" /> {t('auth.back')}
            </button>

            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                {selectedRole === 'customer' && <Home      className="w-4 h-4 text-emerald-600" />}
                {selectedRole === 'driver'   && <Truck     className="w-4 h-4 text-emerald-600" />}
                {selectedRole === 'business' && <Building2 className="w-4 h-4 text-emerald-600" />}
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{t('auth.createAccount')}</h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">
              {selectedRole === 'customer' && t('auth.joinPersonal')}
              {selectedRole === 'driver'   && t('auth.joinDriver')}
              {selectedRole === 'business' && t('auth.joinBusiness')}
            </p>

            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold mb-3 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-60 shadow-sm"
            >
              <GoogleIcon /> {t('auth.continueWithGoogle')}
            </button>

            <button
              type="button"
              onClick={() => handleOAuth('apple')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-gray-900 text-white border border-gray-900 rounded-xl font-semibold hover:bg-black transition disabled:opacity-60 shadow-sm"
            >
              <AppleIcon /> {t('auth.continueWithApple')}
            </button>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">{t('auth.orContinueEmail')}</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.firstName')}</label>
                  <input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                    placeholder="Jane"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.lastName')}</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email')}</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.password')}</label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className={primaryBtnCls}>
                {loading ? t('auth.pleaseWait') : t('auth.createBtn')}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              {t('auth.haveAccount')}{' '}
              <button
                type="button"
                onClick={() => { setAuthMode('signin'); setError(''); }}
                className="text-emerald-600 font-semibold hover:underline"
              >
                {t('header.signIn')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
