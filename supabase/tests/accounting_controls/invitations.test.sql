-- ============================================================================
-- Invitations to a company's books: who may invite, single use, the
-- invited address only, expiry, withdrawal, an ended ledger, and that the
-- token is never readable back.
-- ============================================================================
\set ON_ERROR_STOP 1
\set cust1 '''c0000000-0000-0000-0000-000000000001'''
\set cust2 '''c0000000-0000-0000-0000-000000000002'''
\set drv1  '''d0000000-0000-0000-0000-000000000001'''
\set drv2  '''d0000000-0000-0000-0000-000000000002'''

BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv2);
SELECT tests.throws($$SELECT accounting.invite(tests.l('ledger_a'), 'drv1@test', 'viewer')$$, '42501', 'an accountant cannot invite');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT accounting.invite(tests.l('ledger_a'), 'drv1@test', 'viewer')$$, '42501', 'another company''s owner cannot invite');
SELECT tests.login(:cust1);
CREATE TEMP TABLE i ON COMMIT DROP AS SELECT * FROM accounting.invite(tests.l('ledger_a'), 'drv1@test', 'viewer', 'Leser');
GRANT SELECT ON i TO authenticated;
SELECT tests.ok((SELECT count(*) FROM accounting.invitations WHERE id = (SELECT invitation_id FROM i) AND token_hash <> (SELECT token FROM i)) = 1,
  'the owner invites; only the hash of the token is stored');
SELECT tests.ok((SELECT expires_at FROM i) BETWEEN now() + interval '13 days' AND now() + interval '15 days', 'the invitation expires after 14 days');

-- Expiry
RESET ROLE;
UPDATE accounting.invitations SET expires_at = now() - interval '1 minute' WHERE id = (SELECT invitation_id FROM i);
SET LOCAL ROLE authenticated;
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM i))$$, '22023', 'an expired invitation is refused');
SELECT tests.ok(accounting.role_of(tests.l('ledger_a')) IS NULL, 'and gives no access');

-- A new one; withdrawn before use.
SELECT tests.login(:cust1);
CREATE TEMP TABLE i2 ON COMMIT DROP AS SELECT * FROM accounting.invite(tests.l('ledger_a'), 'drv1@test', 'viewer');
GRANT SELECT ON i2 TO authenticated;
SELECT accounting.revoke_invitation((SELECT invitation_id FROM i2));
SELECT tests.login(:drv1);
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM i2))$$, '22023', 'a withdrawn invitation is refused');

-- A third; the wrong person, a made-up token, then the right person once.
SELECT tests.login(:cust1);
CREATE TEMP TABLE i3 ON COMMIT DROP AS SELECT * FROM accounting.invite(tests.l('ledger_a'), 'drv1@test', 'viewer');
GRANT SELECT ON i3 TO authenticated;
SELECT tests.ok((SELECT status FROM accounting.invitations WHERE id = (SELECT invitation_id FROM i)) = 'revoked',
  'a new invitation to the same address replaces the pending one');
SELECT tests.login(:cust2);
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM i3))$$, '42501', 'another signed-in person cannot use it');
SELECT tests.throws($$SELECT accounting.accept_invitation('not-a-token')$$, '22023', 'a guessed token is refused');
SELECT tests.login(:drv1);
SELECT tests.ok((SELECT count(*) FROM accounting.invitations) = 0, 'the invited person cannot read the invitations');
SELECT accounting.accept_invitation((SELECT token FROM i3));
SELECT tests.ok(accounting.role_of(tests.l('ledger_a')) = 'viewer', 'the invited address accepts and becomes a viewer');
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM i3))$$, '22023', 'the link works once');
SELECT tests.throws($$SELECT accounting.post_voucher(tests.l('ledger_a'), current_date, 'x', '[{"account":"6800","amount":1},{"account":"1920","amount":-1}]')$$,
  '42501', 'a viewer posts nothing');

-- Anonymous callers
SET LOCAL ROLE anon;
SELECT tests.login(NULL, 'anon');
SELECT tests.throws($$SELECT accounting.accept_invitation((SELECT token FROM i3))$$, '42501', 'nobody accepts without signing in');
ROLLBACK;

-- An ended ledger takes no invitations (B, in its own transaction).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT tests.login(:cust2);
SELECT accounting.end_ledger(tests.l('ledger_b'), 'test');
RESET ROLE;
UPDATE accounting.ledgers SET cancel_at = current_date - 1 WHERE id = tests.l('ledger_b');
SET LOCAL ROLE authenticated;
SELECT tests.throws($$SELECT accounting.invite(tests.l('ledger_b'), 'drv1@test', 'viewer')$$, '55000', 'a ledger past its last day takes no invitations');
ROLLBACK;

\echo 'accounting invitations: all tests passed'
