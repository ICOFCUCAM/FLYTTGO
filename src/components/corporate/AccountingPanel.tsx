/**
 * Corporate dashboard → Accounting: the company's books (an add-on priced by
 * turnover, docs/ACCOUNTING_CORE.md). Owners, admins and finance see it;
 * accountants and auditors from outside the company use /accounting.
 */
import { useEffect, useState } from 'react';
import AccountingOffice from '../../accounting/ui/AccountingOffice';
import type { DocumentsHost } from '../../accounting/ui/DocumentsTab';
import { accountingApi, documentsHostFor } from '../../lib/accounting';
import type { Membership } from '../../lib/organizations';

export default function AccountingPanel({ membership }: { membership: Membership }) {
  const [host, setHost] = useState<DocumentsHost | null>(null);
  useEffect(() => { documentsHostFor(membership.organization.id).then(setHost); }, [membership.organization.id]);
  if (!['owner', 'admin', 'finance'].includes(membership.role)) {
    return <p className="text-sm text-gray-500">Accounting is for the company's owners, admins and finance.</p>;
  }
  if (!host) return <p className="text-sm text-gray-500">Loading…</p>;
  return <AccountingOffice api={accountingApi} tenantId={membership.organization.id} host={host} />;
}
