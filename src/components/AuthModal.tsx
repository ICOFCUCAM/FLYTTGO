import React, { useState } from 'react';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { X, Eye, EyeOff } from 'lucide-react';

export default function AuthModal() {
  const { showAuthModal, setShowAuthModal, authMode, setAuthMode } = useApp();
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!showAuthModal) return null;

  const isSignIn = authMode === 'signin';
  const isReset = authMode === 'reset-password';
  const isDriverSignup = authMode === 'driver-signup';
  const role = isDriverSignup ? 'driver' : 'customer';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);

  try {
    if (isReset) {
      const { error } = await resetPassword(email);
      if (error) {
        setError(error.message);
        return;
      }
      setError('Password reset link sent to your email.');
      return;
    }

    if (isSignIn) {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await signUp(email, password, firstName, lastName, role);
      if (error) {
        setError(error.message);
        return;
      }
    }

    setShowAuthModal(false);

  } finally {
    setLoading(false);
  }
}  

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
        <button onClick={() => setShowAuthModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">{isSignIn ? '👋' : isDriverSignup ? '🚐' : '✨'}</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            {isSignIn ? 'Welcome back' : isDriverSignup ? 'Become a Driver' : 'Create account'}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {isSignIn ? 'Sign in to your FlyttGo account' : isDriverSignup ? 'Start earning with FlyttGo' : 'Join FlyttGo today — it\'s free'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-sm mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isSignIn && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none pr-10" />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
         
         {isSignIn && (
  <div className="text-right">
    <button
      type="button"
      onClick={() => setAuthMode('reset-password')}
      className="text-xs text-emerald-600 hover:underline"
    >
      Forgot password?
    </button>
  </div>
)}

          <button type="submit" disabled={loading}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition disabled:opacity-60">
            {loading ? 'Please wait...' : isSignIn ? 'Sign In' : isDriverSignup ? 'Apply as Driver' : 'Create Account'}
          </button>

        <div className="relative flex items-center my-4">
  <div className="flex-grow border-t border-gray-200"></div>
  <span className="mx-3 text-xs text-gray-400">OR</span>
  <div className="flex-grow border-t border-gray-200"></div>
</div>

<button
  type="button"
  onClick={signInWithGoogle}
  className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
>
  <img
    src="https://www.svgrepo.com/show/475656/google-color.svg"
    className="w-4 h-4"
  />
  Continue with Google
</button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          {isReset ? (
  <>
    Remember your password?{' '}
    <button
      onClick={() => setAuthMode('signin')}
      className="text-emerald-600 font-semibold hover:underline"
    >
      Sign in
    </button>
  </>
) : isSignIn ? (
            <>Don't have an account?{' '}
              <button onClick={() => setAuthMode('signup')} className="text-emerald-600 font-semibold hover:underline">Sign up</button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button onClick={() => setAuthMode('signin')} className="text-emerald-600 font-semibold hover:underline">Sign in</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
