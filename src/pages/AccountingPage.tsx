/**
 * /accounting: the books someone was invited to (accountant, bookkeeper,
 * external auditor, viewer), and where an invitation link lands
 * (?invite=<token>). Signing in comes first.
 */
import AccountantHome from '../accounting/ui/AccountantHome';
import { accountingApi, documentsHostFor } from '../lib/accounting';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';

export default function AccountingPage() {
  const { user } = useAuth();
  const { setShowAuthModal, setAuthMode } = useApp();
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null;
  if (!user) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Regnskap · Accounting</h1>
      <p className="text-gray-600 mb-5">Logg inn med e-postadressen invitasjonen ble sendt til. · Sign in with the email address the invitation was sent to.</p>
      <button onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }} className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold">Logg inn · Sign in</button>
    </div>
  );
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <AccountantHome api={accountingApi} invitationToken={token} hostFor={documentsHostFor}
        onTokenUsed={() => window.history.replaceState(null, '', window.location.pathname)} />
    </div>
  );
}
