-- ============================================================================
-- 00014 — Accounting core: double-entry books on Norwegian rules
-- ============================================================================
--
-- PORTABLE. This file knows nothing about FlyttGo. It is copied unchanged
-- into another Supabase project (Ledgera, ICOFCUCAM/FlyttgoTechGroup); the
-- host then supplies its adapter, the accounting.host_* functions below
-- (FlyttGo's: 00015_accounting_flyttgo.sql). Contract: docs/ACCOUNTING_CORE.md.
--
--   * Everything is in the schema `accounting` (expose it to the API).
--   * A ledger per tenant (a company of the host), and one "house" ledger
--     for the host itself (tenant null). A tenant asks for it; the host's
--     operator approves it with its monthly price.
--   * Vouchers (bilag) are numbered per ledger and year without gaps, and
--     are never changed or deleted. A mistake is corrected by a reversing
--     voucher. Lines are written only with their voucher, and a voucher
--     balances (checked at commit). Receipts are kept with their SHA-256 and
--     never removed. Closed periods are never opened again.
--   * MVA on the standard SAF-T codes; terms two-monthly or yearly.
--   * Reports: trial balance, general ledger, income statement, balance
--     sheet, MVA per term. The accountant package and SAF-T are built from
--     them (docs/ACCOUNTING_CORE.md).
--   * The host posts its own events (its invoices, payments …) through
--     accounting.post_entry(), once per source.
--   * The company's back office: its owners and admins (the host says who)
--     invite the people who work on the books: accountant (keeps and closes
--     them), bookkeeper (posts vouchers), external auditor (reads everything
--     and writes notes, for a set time) and viewer (reads). Removed people
--     are kept in the list with a reason; nothing is deleted.
--
-- Safe to re-run. Rollback: drop the schema after the host's adapter
-- (FlyttGo: supabase/rollback/00014_down.sql).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS accounting;
GRANT USAGE ON SCHEMA accounting TO authenticated, service_role;
REVOKE ALL ON SCHEMA accounting FROM anon;


-- ── 0. The host adapter (deny-all until the host replaces it) ──────────────
-- The host defines, with CREATE OR REPLACE:
--   host_can_keep(tenant)    the caller reads and keeps that tenant's books
--                            (tenant null: the house books)
--   host_can_manage(tenant)  the caller asks for or ends the tenant's ledger
--   host_is_operator()       the caller runs the platform (approves ledgers)
--   host_is_server()         the request comes from the host's server
--   host_tenant(tenant)      {legal_name, org_number, vat_registered, active}
--   host_event(tenant, action, details)  the host's own log (may do nothing)
DO $$
BEGIN
  IF to_regprocedure('accounting.host_can_keep(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_can_keep(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_can_manage(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_can_manage(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_is_operator()') IS NULL THEN
    CREATE FUNCTION accounting.host_is_operator() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_is_server()') IS NULL THEN
    CREATE FUNCTION accounting.host_is_server() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  END IF;
  IF to_regprocedure('accounting.host_tenant(uuid)') IS NULL THEN
    CREATE FUNCTION accounting.host_tenant(p_tenant uuid) RETURNS jsonb LANGUAGE sql STABLE AS 'SELECT NULL::jsonb';
  END IF;
  IF to_regprocedure('accounting.host_event(uuid,text,jsonb)') IS NULL THEN
    CREATE FUNCTION accounting.host_event(p_tenant uuid, p_action text, p_details jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
  END IF;
END $$;


-- ── 1. MVA codes (SAF-T standard tax codes) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.mva_codes (
  code        text    PRIMARY KEY,
  direction   text    NOT NULL CHECK (direction IN ('output', 'input', 'none')),
  rate        numeric NOT NULL CHECK (rate IN (0, 12, 15, 25)),
  description text    NOT NULL,
  sort        integer NOT NULL
);
INSERT INTO accounting.mva_codes (code, direction, rate, description, sort) VALUES
  ('0',  'none',   0,  'Ingen mva-behandling', 0),
  ('1',  'input',  25, 'Fradrag for inngående mva, høy sats', 10),
  ('11', 'input',  15, 'Fradrag for inngående mva, middels sats', 11),
  ('13', 'input',  12, 'Fradrag for inngående mva, lav sats', 13),
  ('3',  'output', 25, 'Utgående mva, høy sats', 30),
  ('31', 'output', 15, 'Utgående mva, middels sats', 31),
  ('33', 'output', 12, 'Utgående mva, lav sats', 33),
  ('5',  'output', 0,  'Innenlands omsetning fritatt for mva (nullsats)', 50),
  ('6',  'none',   0,  'Omsetning utenfor merverdiavgiftsloven', 60)
ON CONFLICT (code) DO NOTHING;


-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.ledgers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        UNIQUE,                     -- null: the house ledger
  status         text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'declined', 'ended')),
  legal_name     text        NOT NULL,
  org_number     text,
  vat_registered boolean     NOT NULL DEFAULT false,
  mva_term       text        NOT NULL DEFAULT 'bimonthly' CHECK (mva_term IN ('bimonthly', 'yearly')),
  zero_rate_code text        NOT NULL DEFAULT '6' CHECK (zero_rate_code IN ('5', '6')),
  start_date     date        NOT NULL CHECK (extract(day FROM start_date) = 1),
  auto_post      boolean     NOT NULL DEFAULT true,
  locked_until   date,
  monthly_fee    numeric     CHECK (monthly_fee IS NULL OR monthly_fee >= 0),   -- agreed price; null: the host's price list
  declared_turnover numeric  CHECK (declared_turnover IS NULL OR declared_turnover >= 0),  -- a year's income, as the company states it at the start
  requested_by   uuid,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  ended_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledgers_lock_after_start CHECK (locked_until IS NULL OR locked_until >= start_date - 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ledgers_one_house ON accounting.ledgers ((true)) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS accounting.accounts (
  ledger_id        uuid    NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  code             text    NOT NULL CHECK (code ~ '^[1-8][0-9]{3}$'),
  name             text    NOT NULL CHECK (btrim(name) <> ''),
  default_mva_code text    REFERENCES accounting.mva_codes (code),
  -- SAF-T 1.30 grouping (Skatteetaten's næringsspesifikasjon code list):
  -- what the account is in the business tax return.
  grouping_category text,
  grouping_code     text,
  active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (ledger_id, code),
  CONSTRAINT accounts_grouping CHECK ((grouping_category IS NULL) = (grouping_code IS NULL))
);
ALTER TABLE accounting.accounts ADD COLUMN IF NOT EXISTS grouping_category text, ADD COLUMN IF NOT EXISTS grouping_code text;

-- Which account each kind of posting uses (the host's postings and MVA).
CREATE TABLE IF NOT EXISTS accounting.posting_accounts (
  ledger_id    uuid NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  account_code text NOT NULL,
  PRIMARY KEY (ledger_id, key),
  FOREIGN KEY (ledger_id, account_code) REFERENCES accounting.accounts (ledger_id, code)
);

CREATE TABLE IF NOT EXISTS accounting.counters (
  ledger_id   uuid    NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  year        integer NOT NULL,
  next_number integer NOT NULL,
  PRIMARY KEY (ledger_id, year)
);

CREATE TABLE IF NOT EXISTS accounting.vouchers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id        uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  year             integer     NOT NULL,
  number           integer     NOT NULL,
  voucher_date     date        NOT NULL,
  description      text        NOT NULL CHECK (btrim(description) <> ''),
  source_type      text        NOT NULL CHECK (source_type ~ '^[a-z_]+$'),   -- manual, reversal, or the host's
  source_id        uuid,
  reverses_voucher uuid        REFERENCES accounting.vouchers (id),
  posted_by        uuid,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, year, number),
  CONSTRAINT vouchers_year CHECK (year = extract(year FROM voucher_date)::int),
  CONSTRAINT vouchers_reversal CHECK ((source_type = 'reversal') = (reverses_voucher IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_source_key ON accounting.vouchers (ledger_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_reversed_once ON accounting.vouchers (reverses_voucher) WHERE reverses_voucher IS NOT NULL;
CREATE INDEX IF NOT EXISTS vouchers_ledger_date_idx ON accounting.vouchers (ledger_id, voucher_date);

CREATE TABLE IF NOT EXISTS accounting.voucher_lines (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid    NOT NULL REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  ledger_id    uuid    NOT NULL,
  line_no      integer NOT NULL,
  account_code text    NOT NULL,
  debit        numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  mva_code     text    REFERENCES accounting.mva_codes (code),
  mva_role     text    CHECK (mva_role IN ('basis', 'vat')),
  description  text,
  party        text,                 -- customer or supplier, as on the document
  ref          uuid,                 -- the host's document (e.g. an invoice)
  UNIQUE (voucher_id, line_no),
  FOREIGN KEY (ledger_id, account_code) REFERENCES accounting.accounts (ledger_id, code),
  CONSTRAINT voucher_lines_one_side CHECK ((debit > 0) <> (credit > 0) AND debit = round(debit, 2) AND credit = round(credit, 2)),
  CONSTRAINT voucher_lines_mva CHECK ((mva_code IS NULL) = (mva_role IS NULL))
);
CREATE INDEX IF NOT EXISTS voucher_lines_account_idx ON accounting.voucher_lines (ledger_id, account_code);

CREATE TABLE IF NOT EXISTS accounting.attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid        NOT NULL REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  storage_path text        NOT NULL UNIQUE,
  file_name    text        NOT NULL,
  sha256       text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   bigint      NOT NULL CHECK (size_bytes > 0),
  uploaded_by  uuid,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting.events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_id  uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  actor_id   uuid,
  action     text        NOT NULL,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_ledger_idx ON accounting.events (ledger_id, created_at);

-- The people who work on a company's books besides its owners and admins.
CREATE TABLE IF NOT EXISTS accounting.members (
  ledger_id      uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  user_id        uuid        NOT NULL,
  role           text        NOT NULL CHECK (role IN ('accountant', 'bookkeeper', 'auditor', 'viewer')),
  name           text,
  email          text,
  firm           text,                       -- the accounting or audit firm, when there is one
  valid_until    date,                       -- access ends after this day (an auditor's engagement)
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  added_by       uuid,
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_by     uuid,
  removed_at     timestamptz,
  removed_reason text,
  PRIMARY KEY (ledger_id, user_id)
);

CREATE TABLE IF NOT EXISTS accounting.invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id   uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  email       text        NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+$'),
  role        text        NOT NULL CHECK (role IN ('accountant', 'bookkeeper', 'auditor', 'viewer')),
  name        text,
  firm        text,
  valid_until date,
  token_hash  text        NOT NULL UNIQUE,          -- hex SHA-256 of the token, which is shown once
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_by uuid,
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_ledger_idx ON accounting.invitations (ledger_id, status);

-- Notes on the books (an auditor's remarks, an accountant's questions), on
-- the ledger or one voucher. Written once.
CREATE TABLE IF NOT EXISTS accounting.notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id  uuid        NOT NULL REFERENCES accounting.ledgers (id) ON DELETE RESTRICT,
  voucher_id uuid        REFERENCES accounting.vouchers (id) ON DELETE RESTRICT,
  author_id  uuid,
  role       text        NOT NULL,
  body       text        NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_ledger_idx ON accounting.notes (ledger_id, created_at);


-- ── 3. The books can't be changed ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accounting: % is written once and never changed', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_vouchers ON accounting.vouchers;
CREATE TRIGGER guard_vouchers BEFORE UPDATE OR DELETE ON accounting.vouchers FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_voucher_lines ON accounting.voucher_lines;
CREATE TRIGGER guard_voucher_lines BEFORE UPDATE OR DELETE ON accounting.voucher_lines FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_attachments ON accounting.attachments;
CREATE TRIGGER guard_attachments BEFORE UPDATE OR DELETE ON accounting.attachments FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_events ON accounting.events;
CREATE TRIGGER guard_events BEFORE UPDATE OR DELETE ON accounting.events FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();
DROP TRIGGER IF EXISTS guard_notes ON accounting.notes;
CREATE TRIGGER guard_notes BEFORE UPDATE OR DELETE ON accounting.notes FOR EACH ROW EXECUTE FUNCTION accounting.guard_append_only();

CREATE OR REPLACE FUNCTION accounting.guard_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'accounting: a ledger is never deleted' USING ERRCODE = '42501'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR (NEW.start_date <> OLD.start_date AND EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = OLD.id)) THEN
    RAISE EXCEPTION 'accounting: the ledger''s tenant and, once it has vouchers, its start date are fixed' USING ERRCODE = '42501';
  END IF;
  IF OLD.locked_until IS NOT NULL AND (NEW.locked_until IS NULL OR NEW.locked_until < OLD.locked_until) THEN
    RAISE EXCEPTION 'accounting: a closed period is never opened again' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
    RAISE EXCEPTION 'accounting: an ended ledger stays ended' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_ledgers ON accounting.ledgers;
CREATE TRIGGER guard_ledgers BEFORE UPDATE OR DELETE ON accounting.ledgers FOR EACH ROW EXECUTE FUNCTION accounting.guard_ledger();

CREATE OR REPLACE FUNCTION accounting.guard_account_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accounting: accounts are never deleted; make them inactive' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS guard_accounts ON accounting.accounts;
CREATE TRIGGER guard_accounts BEFORE DELETE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_delete();

-- Lines are written with their voucher (in the same transaction) and in
-- its ledger; every voucher has two lines or more and balances at commit.
-- The checks see every line, whoever commits.
CREATE OR REPLACE FUNCTION accounting.check_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v accounting.vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM accounting.vouchers WHERE id = NEW.voucher_id;
  IF v.posted_at <> now() THEN
    RAISE EXCEPTION 'accounting: lines are added only when their voucher is posted' USING ERRCODE = '42501';
  END IF;
  IF NEW.ledger_id <> v.ledger_id THEN RAISE EXCEPTION 'accounting: a line belongs to its voucher''s ledger' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_line ON accounting.voucher_lines;
CREATE TRIGGER check_line BEFORE INSERT ON accounting.voucher_lines FOR EACH ROW EXECUTE FUNCTION accounting.check_line();

CREATE OR REPLACE FUNCTION accounting.check_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; n integer; d numeric; c numeric;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN v_id := NEW.id; ELSE v_id := (to_jsonb(NEW) ->> 'voucher_id')::uuid; END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, d, c FROM accounting.voucher_lines WHERE voucher_id = v_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'accounting: voucher does not balance: debit % and credit % on % lines', d, c, n USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS check_balance ON accounting.vouchers;
CREATE CONSTRAINT TRIGGER check_balance AFTER INSERT ON accounting.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_balance();
DROP TRIGGER IF EXISTS check_lines_balance ON accounting.voucher_lines;
CREATE CONSTRAINT TRIGGER check_lines_balance AFTER INSERT ON accounting.voucher_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_balance();


-- ── 4. Who reads and keeps the books ────────────────────────────────────────
-- The caller's role in a ledger: 'owner' (the company's owners and admins,
-- or for the house ledger the host's keepers, as the host says), or the role
-- they were given in the back office while it lasts; null otherwise.
CREATE OR REPLACE FUNCTION accounting.role_of(p_ledger uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN accounting.host_can_keep(l.tenant_id) THEN 'owner'
              ELSE (SELECT m.role FROM accounting.members m
                     WHERE m.ledger_id = l.id AND m.user_id = auth.uid() AND m.status = 'active'
                       AND (m.valid_until IS NULL OR m.valid_until >= (now() AT TIME ZONE 'Europe/Oslo')::date)) END
    FROM accounting.ledgers l WHERE l.id = p_ledger;
$$;

CREATE OR REPLACE FUNCTION accounting.can_read(p_ledger uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT accounting.role_of(p_ledger) IS NOT NULL $$;

-- Who manages the back office: the company's owners and admins (the host's
-- operator for the house ledger).
CREATE OR REPLACE FUNCTION accounting.can_manage(p_ledger uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM accounting.ledgers l WHERE l.id = p_ledger
     AND CASE WHEN l.tenant_id IS NULL THEN accounting.host_is_operator() AND accounting.host_can_keep(NULL)
              ELSE accounting.host_can_manage(l.tenant_id) END);
$$;

CREATE OR REPLACE FUNCTION accounting.require_reader(p_ledger uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (accounting.can_read(p_ledger) OR accounting.host_is_server()) THEN
    RAISE EXCEPTION 'accounting: only those who keep these books' USING ERRCODE = '42501';
  END IF;
END $$;

-- An active ledger and a caller in one of the roles. Posting: owner,
-- accountant, bookkeeper. Closing (periods, MVA terms, the year), settings
-- and the chart of accounts: owner, accountant.
CREATE OR REPLACE FUNCTION accounting.require_role(p_ledger uuid, p_roles text[])
RETURNS accounting.ledgers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; r text;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such ledger' USING ERRCODE = '42704'; END IF;
  r := accounting.role_of(p_ledger);
  IF auth.uid() IS NULL OR r IS NULL OR NOT r = ANY (p_roles) THEN
    RAISE EXCEPTION 'accounting: requires role %', array_to_string(p_roles, ' or ') USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is %', l.status USING ERRCODE = '55000'; END IF;
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.log(p_ledger uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO accounting.events (ledger_id, actor_id, action, details) VALUES (p_ledger, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

ALTER TABLE accounting.mva_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.ledgers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.posting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.vouchers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.voucher_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.events           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mva_codes_read ON accounting.mva_codes;
CREATE POLICY mva_codes_read ON accounting.mva_codes FOR SELECT TO authenticated USING (true);
-- The ledger row: its keepers, and the host's operator (who approves it and
-- sets its price) sees the row, never the books.
DROP POLICY IF EXISTS ledgers_read ON accounting.ledgers;
CREATE POLICY ledgers_read ON accounting.ledgers FOR SELECT TO authenticated
  USING (accounting.host_is_operator() OR accounting.can_read(id) OR accounting.can_manage(id));
DROP POLICY IF EXISTS accounts_read ON accounting.accounts;
CREATE POLICY accounts_read ON accounting.accounts FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS posting_accounts_read ON accounting.posting_accounts;
CREATE POLICY posting_accounts_read ON accounting.posting_accounts FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS vouchers_read ON accounting.vouchers;
CREATE POLICY vouchers_read ON accounting.vouchers FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS voucher_lines_read ON accounting.voucher_lines;
CREATE POLICY voucher_lines_read ON accounting.voucher_lines FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
DROP POLICY IF EXISTS attachments_read ON accounting.attachments;
CREATE POLICY attachments_read ON accounting.attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM accounting.vouchers v WHERE v.id = voucher_id AND accounting.can_read(v.ledger_id)));
DROP POLICY IF EXISTS events_read ON accounting.events;
CREATE POLICY events_read ON accounting.events FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));
ALTER TABLE accounting.members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.notes       ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_read ON accounting.members;
CREATE POLICY members_read ON accounting.members FOR SELECT TO authenticated
  USING (accounting.can_read(ledger_id) OR accounting.can_manage(ledger_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS invitations_read ON accounting.invitations;
CREATE POLICY invitations_read ON accounting.invitations FOR SELECT TO authenticated USING (accounting.can_manage(ledger_id));
DROP POLICY IF EXISTS notes_read ON accounting.notes;
CREATE POLICY notes_read ON accounting.notes FOR SELECT TO authenticated USING (accounting.can_read(ledger_id));

REVOKE ALL ON ALL TABLES IN SCHEMA accounting FROM anon, authenticated;
GRANT SELECT ON accounting.mva_codes, accounting.ledgers, accounting.accounts, accounting.posting_accounts,
                accounting.vouchers, accounting.voucher_lines, accounting.attachments, accounting.events,
                accounting.members, accounting.invitations, accounting.notes TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA accounting TO service_role;


-- ── 5. Chart of accounts (NS 4102: what a small company uses) ───────────────
CREATE OR REPLACE FUNCTION accounting.seed(p_ledger uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO accounting.accounts (ledger_id, code, name, default_mva_code)
  SELECT p_ledger, a.code, a.name, a.mva FROM (VALUES
    ('1200', 'Maskiner og anlegg', NULL), ('1230', 'Biler', NULL), ('1250', 'Inventar', NULL),
    ('1280', 'Kontormaskiner', NULL), ('1500', 'Kundefordringer', NULL), ('1570', 'Andre kortsiktige fordringer', NULL),
    ('1700', 'Forskuddsbetalte kostnader', NULL), ('1900', 'Kontanter', NULL), ('1920', 'Bankinnskudd', NULL),
    ('1940', 'Betalingsformidler (kort)', NULL), ('1941', 'Betalingsformidler (Vipps)', NULL),
    ('1950', 'Bankinnskudd for skattetrekk', NULL),
    ('2000', 'Aksjekapital', NULL), ('2050', 'Annen egenkapital', NULL), ('2080', 'Udekket tap', NULL),
    ('2400', 'Leverandørgjeld', NULL), ('2500', 'Betalbar skatt', NULL), ('2600', 'Forskuddstrekk', NULL),
    ('2700', 'Utgående merverdiavgift, høy sats', NULL), ('2701', 'Utgående merverdiavgift, middels sats', NULL),
    ('2702', 'Utgående merverdiavgift, lav sats', NULL), ('2710', 'Inngående merverdiavgift, høy sats', NULL),
    ('2711', 'Inngående merverdiavgift, middels sats', NULL), ('2712', 'Inngående merverdiavgift, lav sats', NULL),
    ('2740', 'Oppgjørskonto merverdiavgift', NULL), ('2770', 'Skyldig arbeidsgiveravgift', NULL),
    ('2780', 'Påløpt arbeidsgiveravgift på påløpt lønn', NULL), ('2900', 'Annen kortsiktig gjeld', NULL),
    ('2910', 'Gjeld til ansatte og eiere', NULL), ('2940', 'Skyldige feriepenger', NULL),
    ('3000', 'Salgsinntekt, avgiftspliktig, høy sats', '3'), ('3001', 'Salgsinntekt, avgiftspliktig, middels sats', '31'),
    ('3002', 'Salgsinntekt, avgiftspliktig, lav sats', '33'), ('3100', 'Salgsinntekt, avgiftsfri', NULL),
    ('3900', 'Annen driftsrelatert inntekt', '6'),
    ('4000', 'Innkjøp av varer', '1'), ('4300', 'Innkjøp av varer for videresalg', '1'), ('4500', 'Fremmedytelser og underentreprise', '1'),
    ('5000', 'Lønn til ansatte', NULL), ('5180', 'Feriepenger', NULL), ('5400', 'Arbeidsgiveravgift', NULL),
    ('6000', 'Avskrivning på varige driftsmidler', NULL), ('6300', 'Leie lokale', NULL), ('6340', 'Lys, varme', '1'),
    ('6540', 'Inventar', '1'), ('6550', 'Driftsmateriale', '1'), ('6600', 'Reparasjon og vedlikehold bygninger', '1'),
    ('6700', 'Revisjonshonorar', '1'), ('6705', 'Regnskapshonorar', '1'), ('6800', 'Kontorrekvisita', '1'),
    ('6810', 'Data/EDB-kostnad', '1'), ('6900', 'Telefon', '1'), ('6940', 'Porto', NULL),
    ('7000', 'Drivstoff', '1'), ('7020', 'Vedlikehold transportmidler', '1'), ('7040', 'Forsikring transportmidler', NULL),
    ('7100', 'Bilgodtgjørelse', NULL), ('7140', 'Reisekostnad', NULL), ('7320', 'Reklamekostnad', '1'),
    ('7350', 'Representasjon', NULL), ('7500', 'Forsikringspremie', NULL), ('7770', 'Bank- og kortgebyrer', NULL),
    ('7790', 'Annen kostnad', NULL),
    ('8050', 'Annen renteinntekt', NULL), ('8150', 'Annen rentekostnad', NULL), ('8300', 'Betalbar skatt', NULL),
    ('8800', 'Årsresultat', NULL)
  ) AS a(code, name, mva)
  ON CONFLICT (ledger_id, code) DO NOTHING;
  -- Their grouping in the næringsspesifikasjon (Skatteetaten's 2025–2026
  -- list). Judgement calls the accountant may change: vans are 1238 rather
  -- than 1205; payment-provider balances are treated as bank.
  UPDATE accounting.accounts a SET grouping_category = g.cat, grouping_code = g.code
    FROM (VALUES
    ('1200', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1230', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1250', 'balanseverdiForAnleggsmiddel', '1205'),
    ('1280', 'balanseverdiForAnleggsmiddel', '1280'),
    ('1500', 'balanseverdiForOmloepsmiddel', '1500'),
    ('1570', 'balanseverdiForOmloepsmiddel', '1570'),
    ('1700', 'balanseverdiForOmloepsmiddel', '1570'),
    ('1900', 'balanseverdiForOmloepsmiddel', '1900'),
    ('1920', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1940', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1941', 'balanseverdiForOmloepsmiddel', '1920'),
    ('1950', 'balanseverdiForOmloepsmiddel', '1950'),
    ('2000', 'egenkapital', '2000'),
    ('2050', 'egenkapital', '2050'),
    ('2080', 'egenkapital', '2080'),
    ('2400', 'kortsiktigGjeld', '2400'),
    ('2500', 'kortsiktigGjeld', '2500'),
    ('2600', 'kortsiktigGjeld', '2600'),
    ('2700', 'kortsiktigGjeld', '2740'),
    ('2701', 'kortsiktigGjeld', '2740'),
    ('2702', 'kortsiktigGjeld', '2740'),
    ('2710', 'kortsiktigGjeld', '2740'),
    ('2711', 'kortsiktigGjeld', '2740'),
    ('2712', 'kortsiktigGjeld', '2740'),
    ('2740', 'kortsiktigGjeld', '2740'),
    ('2770', 'kortsiktigGjeld', '2770'),
    ('2780', 'kortsiktigGjeld', '2770'),
    ('2900', 'kortsiktigGjeld', '2990'),
    ('2910', 'kortsiktigGjeld', '2910'),
    ('2940', 'kortsiktigGjeld', '2949'),
    ('3000', 'salgsinntekt', '3000'),
    ('3001', 'salgsinntekt', '3000'),
    ('3002', 'salgsinntekt', '3000'),
    ('3100', 'salgsinntekt', '3100'),
    ('3900', 'annenDriftsinntekt', '3900'),
    ('4000', 'varekostnad', '4005'),
    ('4300', 'varekostnad', '4005'),
    ('4500', 'varekostnad', '4500'),
    ('5000', 'loennskostnad', '5000'),
    ('5180', 'loennskostnad', '5000'),
    ('5400', 'loennskostnad', '5400'),
    ('6000', 'annenDriftskostnad', '6000'),
    ('6300', 'annenDriftskostnad', '6300'),
    ('6340', 'annenDriftskostnad', '6340'),
    ('6540', 'annenDriftskostnad', '6500'),
    ('6550', 'annenDriftskostnad', '6500'),
    ('6600', 'annenDriftskostnad', '6600'),
    ('6700', 'annenDriftskostnad', '6700'),
    ('6705', 'annenDriftskostnad', '6700'),
    ('6800', 'annenDriftskostnad', '6995'),
    ('6810', 'annenDriftskostnad', '6995'),
    ('6900', 'annenDriftskostnad', '6995'),
    ('6940', 'annenDriftskostnad', '6995'),
    ('7000', 'annenDriftskostnad', '7000'),
    ('7020', 'annenDriftskostnad', '7020'),
    ('7040', 'annenDriftskostnad', '7040'),
    ('7100', 'annenDriftskostnad', '7155'),
    ('7140', 'annenDriftskostnad', '7165'),
    ('7320', 'annenDriftskostnad', '7330'),
    ('7350', 'annenDriftskostnad', '7350'),
    ('7500', 'annenDriftskostnad', '7500'),
    ('7770', 'annenDriftskostnad', '7700'),
    ('7790', 'annenDriftskostnad', '7700'),
    ('8050', 'finansinntekt', '8050'),
    ('8150', 'finanskostnad', '8150'),
    ('8300', 'skattekostnad', '8300'),
    ('8800', 'resultatDisponeringForSAF-T', '8800')
    ) AS g(account, cat, code)
   WHERE a.ledger_id = p_ledger AND a.code = g.account AND a.grouping_code IS NULL;
  INSERT INTO accounting.posting_accounts (ledger_id, key, account_code)
  SELECT p_ledger, k.key, k.code FROM (VALUES
    ('receivables', '1500'), ('payables', '2400'), ('sales_25', '3000'), ('sales_15', '3001'), ('sales_12', '3002'), ('sales_0', '3100'),
    ('output_vat_25', '2700'), ('output_vat_15', '2701'), ('output_vat_12', '2702'),
    ('input_vat_25', '2710'), ('input_vat_15', '2711'), ('input_vat_12', '2712'), ('vat_settlement', '2740'),
    ('bank', '1920'), ('card', '1940'), ('vipps', '1941'), ('other', '1920'), ('platform_fee', '1940'),
    ('reminder_fee', '3900'), ('late_interest', '8050'), ('year_result', '8800'), ('equity', '2050')
  ) AS k(key, code)
  ON CONFLICT (ledger_id, key) DO NOTHING;
END $$;


-- ── 6. Opening and running a ledger ─────────────────────────────────────────
DROP FUNCTION IF EXISTS accounting.request_ledger(uuid, date, text);
CREATE OR REPLACE FUNCTION accounting.request_ledger(p_tenant uuid, p_start date, p_mva_term text DEFAULT 'bimonthly',
                                                    p_declared_turnover numeric DEFAULT NULL)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE t jsonb; l accounting.ledgers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_tenant IS NULL OR NOT accounting.host_can_manage(p_tenant) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins ask for it' USING ERRCODE = '42501';
  END IF;
  t := accounting.host_tenant(p_tenant);
  IF t IS NULL OR NOT coalesce((t ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'accounting: the company must be verified and active first' USING ERRCODE = '55000';
  END IF;
  IF p_start IS NULL OR extract(day FROM p_start) <> 1 THEN
    RAISE EXCEPTION 'accounting: the books start on the first day of a month' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE tenant_id = p_tenant;
  IF FOUND AND l.status IN ('active', 'ended') THEN
    RAISE EXCEPTION 'accounting: the company''s ledger is already %', l.status USING ERRCODE = '55000';
  END IF;
  IF p_declared_turnover IS NOT NULL AND p_declared_turnover < 0 THEN
    RAISE EXCEPTION 'accounting: the turnover cannot be negative' USING ERRCODE = '22023';
  END IF;
  INSERT INTO accounting.ledgers AS x (tenant_id, status, legal_name, org_number, vat_registered, mva_term, start_date,
                                       declared_turnover, requested_by)
  VALUES (p_tenant, 'requested', t ->> 'legal_name', t ->> 'org_number', coalesce((t ->> 'vat_registered')::boolean, false),
          coalesce(p_mva_term, 'bimonthly'), p_start, p_declared_turnover, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET status = 'requested', legal_name = EXCLUDED.legal_name, org_number = EXCLUDED.org_number,
    vat_registered = EXCLUDED.vat_registered, start_date = EXCLUDED.start_date, mva_term = EXCLUDED.mva_term,
    declared_turnover = EXCLUDED.declared_turnover,
    requested_by = EXCLUDED.requested_by, decided_by = NULL, decided_at = NULL, decision_note = NULL
  RETURNING * INTO l;
  PERFORM accounting.log(l.id, 'ledger.requested', jsonb_build_object('start_date', p_start, 'mva_term', l.mva_term));
  PERFORM accounting.host_event(p_tenant, 'accounting.requested', jsonb_build_object('start_date', p_start));
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.decide_ledger(p_ledger uuid, p_approve boolean, p_monthly_fee numeric, p_note text)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT accounting.host_is_operator() THEN RAISE EXCEPTION 'accounting: the platform''s administrators decide' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR UPDATE;
  IF NOT FOUND OR l.status <> 'requested' THEN RAISE EXCEPTION 'accounting: nothing to decide' USING ERRCODE = '55000'; END IF;
  UPDATE accounting.ledgers SET status = CASE WHEN p_approve THEN 'active' ELSE 'declined' END,
         monthly_fee = CASE WHEN p_approve THEN p_monthly_fee END,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_ledger RETURNING * INTO l;
  IF p_approve THEN PERFORM accounting.seed(p_ledger); END IF;
  PERFORM accounting.log(p_ledger, CASE WHEN p_approve THEN 'ledger.approved' ELSE 'ledger.declined' END,
                         jsonb_build_object('monthly_fee', l.monthly_fee, 'note', p_note));
  PERFORM accounting.host_event(l.tenant_id, CASE WHEN p_approve THEN 'accounting.approved' ELSE 'accounting.declined' END,
                                jsonb_build_object('monthly_fee', l.monthly_fee));
  RETURN l;
END $$;

-- The host's own books.
CREATE OR REPLACE FUNCTION accounting.open_house_ledger(p_legal_name text, p_org_number text, p_start date, p_mva_term text DEFAULT 'bimonthly')
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  IF NOT (accounting.host_is_operator() AND accounting.host_can_keep(NULL)) THEN
    RAISE EXCEPTION 'accounting: the platform''s administrators only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_legal_name), '') = '' THEN RAISE EXCEPTION 'accounting: the legal name is needed' USING ERRCODE = '22023'; END IF;
  IF p_start IS NULL OR extract(day FROM p_start) <> 1 THEN
    RAISE EXCEPTION 'accounting: the books start on the first day of a month' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.ledgers WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'accounting: the house ledger is already open' USING ERRCODE = '55000';
  END IF;
  INSERT INTO accounting.ledgers (tenant_id, status, legal_name, org_number, vat_registered, mva_term, start_date, requested_by, decided_by, decided_at)
  VALUES (NULL, 'active', btrim(p_legal_name), nullif(btrim(coalesce(p_org_number, '')), ''), true,
          coalesce(p_mva_term, 'bimonthly'), p_start, auth.uid(), auth.uid(), now())
  RETURNING * INTO l;
  PERFORM accounting.seed(l.id);
  PERFORM accounting.log(l.id, 'ledger.opened', jsonb_build_object('start_date', p_start));
  RETURN l;
END $$;

CREATE OR REPLACE FUNCTION accounting.set_settings(p_ledger uuid, p jsonb)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  UPDATE accounting.ledgers SET
    vat_registered = coalesce((p ->> 'vat_registered')::boolean, vat_registered),
    mva_term       = coalesce(p ->> 'mva_term', mva_term),
    zero_rate_code = coalesce(p ->> 'zero_rate_code', zero_rate_code),
    auto_post      = coalesce((p ->> 'auto_post')::boolean, auto_post),
    legal_name     = coalesce(nullif(btrim(p ->> 'legal_name'), ''), legal_name),
    org_number     = coalesce(nullif(btrim(p ->> 'org_number'), ''), org_number)
   WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.settings', p);
  RETURN l;
END $$;

DROP FUNCTION IF EXISTS accounting.save_account(uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION accounting.save_account(p_ledger uuid, p_code text, p_name text, p_mva_code text, p_active boolean,
                                                  p_grouping_category text DEFAULT NULL, p_grouping_code text DEFAULT NULL)
RETURNS accounting.accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE a accounting.accounts%ROWTYPE;
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  IF NOT coalesce(p_active, true) AND EXISTS (SELECT 1 FROM accounting.posting_accounts WHERE ledger_id = p_ledger AND account_code = p_code) THEN
    RAISE EXCEPTION 'accounting: account % is used for automatic posting; choose another account there first', p_code USING ERRCODE = '55000';
  END IF;
  INSERT INTO accounting.accounts AS x (ledger_id, code, name, default_mva_code, active, grouping_category, grouping_code)
  VALUES (p_ledger, p_code, btrim(p_name), nullif(p_mva_code, ''), coalesce(p_active, true),
          nullif(btrim(coalesce(p_grouping_category, '')), ''), nullif(btrim(coalesce(p_grouping_code, '')), ''))
  ON CONFLICT (ledger_id, code) DO UPDATE SET name = EXCLUDED.name, default_mva_code = EXCLUDED.default_mva_code, active = EXCLUDED.active,
    grouping_category = coalesce(EXCLUDED.grouping_category, x.grouping_category), grouping_code = coalesce(EXCLUDED.grouping_code, x.grouping_code)
  RETURNING * INTO a;
  PERFORM accounting.log(p_ledger, 'ledger.account', jsonb_build_object('code', p_code, 'name', a.name, 'active', a.active));
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION accounting.set_posting_account(p_ledger uuid, p_key text, p_code text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
  IF NOT EXISTS (SELECT 1 FROM accounting.accounts WHERE ledger_id = p_ledger AND code = p_code AND active) THEN
    RAISE EXCEPTION 'accounting: no active account %', p_code USING ERRCODE = '22023';
  END IF;
  UPDATE accounting.posting_accounts SET account_code = p_code WHERE ledger_id = p_ledger AND key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no posting key %', p_key USING ERRCODE = '22023'; END IF;
  PERFORM accounting.log(p_ledger, 'ledger.posting_account', jsonb_build_object('key', p_key, 'code', p_code));
END $$;

-- Ending the service: no new vouchers; the books stay readable (keep them
-- 5 years, bokføringsloven § 13).
CREATE OR REPLACE FUNCTION accounting.end_ledger(p_ledger uuid, p_reason text)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE;
BEGIN
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF l.tenant_id IS NULL OR NOT accounting.host_can_manage(l.tenant_id) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins end it' USING ERRCODE = '42501';
  END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is %', l.status USING ERRCODE = '55000'; END IF;
  UPDATE accounting.ledgers SET status = 'ended', ended_at = now() WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.ended', jsonb_build_object('reason', p_reason));
  PERFORM accounting.host_event(l.tenant_id, 'accounting.ended', jsonb_build_object('reason', p_reason));
  RETURN l;
END $$;


-- ── 6b. The back office: people and notes ──────────────────────────────────
-- Invite someone by email. Returns the token once (for the link the host
-- emails); only its hash is kept.
CREATE OR REPLACE FUNCTION accounting.invite(p_ledger uuid, p_email text, p_role text, p_name text DEFAULT NULL,
                                             p_firm text DEFAULT NULL, p_valid_until date DEFAULT NULL)
RETURNS TABLE (invitation_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
        v_email text := lower(btrim(coalesce(p_email, ''))); i accounting.invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounting.ledgers WHERE id = p_ledger AND status = 'active') THEN
    RAISE EXCEPTION 'accounting: the ledger is not active' USING ERRCODE = '55000';
  END IF;
  IF p_role = 'auditor' AND p_valid_until IS NULL THEN
    RAISE EXCEPTION 'accounting: an external auditor''s access needs an end date' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.members m JOIN auth.users u ON u.id = m.user_id
              WHERE m.ledger_id = p_ledger AND m.status = 'active' AND lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'accounting: % already has access', v_email USING ERRCODE = '23505';
  END IF;
  UPDATE accounting.invitations SET status = 'revoked' WHERE ledger_id = p_ledger AND email = v_email AND status = 'pending';
  INSERT INTO accounting.invitations (ledger_id, email, role, name, firm, valid_until, token_hash, invited_by)
  VALUES (p_ledger, v_email, p_role, nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_firm, '')), ''),
          p_valid_until, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  RETURNING * INTO i;
  PERFORM accounting.log(p_ledger, 'member.invited', jsonb_build_object('email', v_email, 'role', p_role, 'valid_until', p_valid_until));
  RETURN QUERY SELECT i.id, v_token, i.expires_at;
END $$;

-- The invited person, signed in with the invited email address, accepts.
CREATE OR REPLACE FUNCTION accounting.accept_invitation(p_token text)
RETURNS accounting.members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE i accounting.invitations%ROWTYPE; m accounting.members%ROWTYPE; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'accounting: sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM accounting.invitations WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND OR i.status <> 'pending' OR i.expires_at < now() THEN
    RAISE EXCEPTION 'accounting: the invitation is not valid (used, withdrawn or expired)' USING ERRCODE = '22023';
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS DISTINCT FROM i.email THEN
    RAISE EXCEPTION 'accounting: sign in with % to accept', i.email USING ERRCODE = '42501';
  END IF;
  INSERT INTO accounting.members AS x (ledger_id, user_id, role, name, email, firm, valid_until, added_by)
  VALUES (i.ledger_id, auth.uid(), i.role, i.name, i.email, i.firm, i.valid_until, i.invited_by)
  ON CONFLICT (ledger_id, user_id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email,
    firm = EXCLUDED.firm, valid_until = EXCLUDED.valid_until, status = 'active', added_by = EXCLUDED.added_by, added_at = now(),
    removed_by = NULL, removed_at = NULL, removed_reason = NULL
  RETURNING * INTO m;
  UPDATE accounting.invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = i.id;
  PERFORM accounting.log(i.ledger_id, 'member.joined', jsonb_build_object('email', i.email, 'role', i.role));
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION accounting.revoke_invitation(p_invitation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE i accounting.invitations%ROWTYPE;
BEGIN
  SELECT * INTO i FROM accounting.invitations WHERE id = p_invitation;
  IF NOT FOUND OR NOT accounting.can_manage(i.ledger_id) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  UPDATE accounting.invitations SET status = 'revoked' WHERE id = p_invitation AND status = 'pending';
  PERFORM accounting.log(i.ledger_id, 'member.invitation_revoked', jsonb_build_object('email', i.email));
END $$;

-- Change someone's role or end date, or remove them (kept, with the reason).
CREATE OR REPLACE FUNCTION accounting.update_member(p_ledger uuid, p_user uuid, p_role text, p_valid_until date)
RETURNS accounting.members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m accounting.members%ROWTYPE;
BEGIN
  IF NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'auditor' AND p_valid_until IS NULL THEN
    RAISE EXCEPTION 'accounting: an external auditor''s access needs an end date' USING ERRCODE = '22023';
  END IF;
  UPDATE accounting.members SET role = p_role, valid_until = p_valid_until
   WHERE ledger_id = p_ledger AND user_id = p_user AND status = 'active' RETURNING * INTO m;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such person in the back office' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.log(p_ledger, 'member.changed', jsonb_build_object('user', p_user, 'role', p_role, 'valid_until', p_valid_until));
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION accounting.remove_member(p_ledger uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT accounting.can_manage(p_ledger) THEN
    RAISE EXCEPTION 'accounting: the company''s owners and admins manage the back office' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'accounting: removing someone needs a reason' USING ERRCODE = '22023'; END IF;
  UPDATE accounting.members SET status = 'removed', removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   WHERE ledger_id = p_ledger AND user_id = p_user AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such person in the back office' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.log(p_ledger, 'member.removed', jsonb_build_object('user', p_user, 'reason', p_reason));
END $$;

-- A note by anyone who reads the books (the auditor's remarks among them).
CREATE OR REPLACE FUNCTION accounting.add_note(p_ledger uuid, p_voucher uuid, p_body text)
RETURNS accounting.notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r text := accounting.role_of(p_ledger); n accounting.notes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR r IS NULL THEN RAISE EXCEPTION 'accounting: only those who work on these books' USING ERRCODE = '42501'; END IF;
  IF p_voucher IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounting.vouchers WHERE id = p_voucher AND ledger_id = p_ledger) THEN
    RAISE EXCEPTION 'accounting: no such voucher in this ledger' USING ERRCODE = '42704';
  END IF;
  INSERT INTO accounting.notes (ledger_id, voucher_id, author_id, role, body) VALUES (p_ledger, p_voucher, auth.uid(), r, btrim(p_body))
  RETURNING * INTO n;
  RETURN n;
END $$;

-- The ledgers the caller works on (as owner or in the back office), for
-- the office's ledger picker.
CREATE OR REPLACE FUNCTION accounting.my_ledgers()
RETURNS TABLE (ledger_id uuid, legal_name text, status text, role text, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.id, l.legal_name, l.status, accounting.role_of(l.id), l.tenant_id FROM accounting.ledgers l
   WHERE l.status IN ('active', 'ended') AND accounting.role_of(l.id) IS NOT NULL
   ORDER BY l.legal_name;
$$;


-- ── 7. Posting ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounting.account_for(p_ledger uuid, p_key text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c text;
BEGIN
  SELECT account_code INTO c FROM accounting.posting_accounts WHERE ledger_id = p_ledger AND key = p_key;
  IF c IS NULL THEN RAISE EXCEPTION 'accounting: no account chosen for %', p_key USING ERRCODE = '22023'; END IF;
  RETURN c;
END $$;

-- A signed amount as a line: positive on the debit side, negative on the credit side.
CREATE OR REPLACE FUNCTION accounting.line(p_account text, p_amount numeric, p_mva_code text DEFAULT NULL, p_mva_role text DEFAULT NULL,
                                           p_description text DEFAULT NULL, p_party text DEFAULT NULL, p_ref uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('account', p_account,
    'debit', CASE WHEN p_amount > 0 THEN p_amount END, 'credit', CASE WHEN p_amount < 0 THEN -p_amount END,
    'mva_code', p_mva_code, 'mva_role', CASE WHEN p_mva_code IS NOT NULL THEN coalesce(p_mva_role, 'basis') END,
    'description', p_description, 'party', p_party, 'ref', p_ref));
$$;

-- The one place a voucher is written. p_lines: [{account, debit | credit,
-- mva_code, mva_role, description, party, ref}], already split into net and
-- MVA. Numbers follow in order per ledger and year.
CREATE OR REPLACE FUNCTION accounting.insert_voucher(p_ledger uuid, p_date date, p_description text, p_source_type text,
                                                     p_source_id uuid, p_lines jsonb, p_reverses uuid DEFAULT NULL)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE; x jsonb; n integer := 0;
  v_year integer := extract(year FROM p_date)::int; v_number integer;
BEGIN
  -- FOR SHARE: a period being closed (or the ledger ended) at the same moment
  -- waits for this voucher, or this voucher sees the new lock date.
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger FOR SHARE;
  IF NOT FOUND OR l.status <> 'active' THEN RAISE EXCEPTION 'accounting: the ledger is not active' USING ERRCODE = '55000'; END IF;
  IF p_date IS NULL OR p_date < l.start_date THEN
    RAISE EXCEPTION 'accounting: % is before the books start (%)', p_date, l.start_date USING ERRCODE = '22023';
  END IF;
  IF l.locked_until IS NOT NULL AND p_date <= l.locked_until THEN
    RAISE EXCEPTION 'accounting: the period up to % is closed', l.locked_until USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'accounting: a voucher needs at least two lines' USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounting.counters AS c (ledger_id, year, next_number) VALUES (p_ledger, v_year, 2)
  ON CONFLICT (ledger_id, year) DO UPDATE SET next_number = c.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO accounting.vouchers (ledger_id, year, number, voucher_date, description, source_type, source_id, reverses_voucher, posted_by)
  VALUES (p_ledger, v_year, v_number, p_date, btrim(p_description), p_source_type, p_source_id, p_reverses, auth.uid())
  RETURNING * INTO v;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF NOT EXISTS (SELECT 1 FROM accounting.accounts WHERE ledger_id = p_ledger AND code = x ->> 'account' AND active) THEN
      RAISE EXCEPTION 'accounting: no active account %', x ->> 'account' USING ERRCODE = '22023';
    END IF;
    n := n + 1;
    INSERT INTO accounting.voucher_lines (voucher_id, ledger_id, line_no, account_code, debit, credit, mva_code, mva_role,
                                          description, party, ref)
    VALUES (v.id, p_ledger, n, x ->> 'account', round(coalesce((x ->> 'debit')::numeric, 0), 2),
            round(coalesce((x ->> 'credit')::numeric, 0), 2), nullif(x ->> 'mva_code', ''), nullif(x ->> 'mva_role', ''),
            nullif(btrim(coalesce(x ->> 'description', '')), ''), nullif(btrim(coalesce(x ->> 'party', '')), ''),
            nullif(x ->> 'ref', '')::uuid);
  END LOOP;
  RETURN v;
END $$;

-- The ledger the host posts a tenant's events into: active, posting
-- automatically. Null when there is none.
CREATE OR REPLACE FUNCTION accounting.ledger_for(p_tenant uuid)
RETURNS accounting.ledgers
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT * FROM accounting.ledgers
   WHERE (tenant_id = p_tenant OR (p_tenant IS NULL AND tenant_id IS NULL)) AND status = 'active' AND auto_post;
$$;

-- For the host: post one of its events (an invoice, a payment …) once.
-- Before the books start: nothing. In a closed period: on the first open
-- day. Returns the voucher (the existing one when already posted).
CREATE OR REPLACE FUNCTION accounting.post_entry(p_ledger uuid, p_date date, p_description text, p_source_type text,
                                                 p_source_id uuid, p_lines jsonb)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; v accounting.vouchers%ROWTYPE;
BEGIN
  IF p_source_type IN ('manual', 'reversal') OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'accounting: an entry names its source' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF NOT FOUND OR p_date < l.start_date THEN RETURN NULL; END IF;
  SELECT * INTO v FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = p_source_type AND source_id = p_source_id;
  IF FOUND THEN RETURN v; END IF;
  RETURN accounting.insert_voucher(p_ledger,
           CASE WHEN l.locked_until IS NOT NULL AND p_date <= l.locked_until THEN l.locked_until + 1 ELSE p_date END,
           p_description, p_source_type, p_source_id, p_lines);
END $$;

-- A manual voucher (purchases, salaries, bank costs …). Each line:
-- {account, amount (positive debit, negative credit), mva_code, description,
-- party}. With an MVA code above 0 % the amount includes MVA and is split
-- into the net amount and the MVA line.
CREATE OR REPLACE FUNCTION accounting.post_voucher(p_ledger uuid, p_date date, p_description text, p_lines jsonb)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant', 'bookkeeper']);
  x jsonb; m accounting.mva_codes%ROWTYPE; out jsonb := '[]'::jsonb; v_amount numeric; v_vat numeric;
  v accounting.vouchers%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_description), '') = '' THEN RAISE EXCEPTION 'accounting: a voucher needs a description' USING ERRCODE = '22023'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_amount := round((x ->> 'amount')::numeric, 2);
    IF v_amount IS NULL OR v_amount = 0 THEN RAISE EXCEPTION 'accounting: every line needs an amount' USING ERRCODE = '22023'; END IF;
    m := NULL;
    IF nullif(x ->> 'mva_code', '') IS NOT NULL THEN
      SELECT * INTO m FROM accounting.mva_codes WHERE code = x ->> 'mva_code';
      IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no MVA code %', x ->> 'mva_code' USING ERRCODE = '22023'; END IF;
      IF NOT l.vat_registered AND m.direction <> 'none' THEN
        RAISE EXCEPTION 'accounting: the company is not registered for MVA' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF m.code IS NOT NULL AND m.rate > 0 THEN
      v_vat := round(v_amount * m.rate / (100 + m.rate), 2);
      out := out || accounting.line(x ->> 'account', v_amount - v_vat, m.code, 'basis', x ->> 'description', x ->> 'party')
                 || accounting.line(accounting.account_for(p_ledger, m.direction || '_vat_' || m.rate::int), v_vat, m.code, 'vat',
                                    x ->> 'description', x ->> 'party');
    ELSE
      out := out || accounting.line(x ->> 'account', v_amount, m.code, 'basis', x ->> 'description', x ->> 'party');
    END IF;
  END LOOP;
  v := accounting.insert_voucher(p_ledger, p_date, p_description, 'manual', NULL, out);
  PERFORM accounting.log(p_ledger, 'voucher.posted', jsonb_build_object('voucher', v.id, 'number', v.year || '-' || v.number));
  RETURN v;
END $$;

-- A correction of a manual voucher: the same lines on the opposite side,
-- with a reason. The host's entries are corrected at their source (a
-- credit note), which posts its own voucher.
CREATE OR REPLACE FUNCTION accounting.reverse_voucher(p_voucher uuid, p_date date, p_reason text)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o accounting.vouchers%ROWTYPE; v accounting.vouchers%ROWTYPE; lines jsonb;
BEGIN
  SELECT * INTO o FROM accounting.vouchers WHERE id = p_voucher;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such voucher' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.require_role(o.ledger_id, ARRAY['owner', 'accountant']);
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'accounting: a reversal needs a reason' USING ERRCODE = '22023'; END IF;
  IF o.source_type <> 'manual' THEN
    RAISE EXCEPTION 'accounting: correct this at its source (for an invoice: a credit note)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE reverses_voucher = p_voucher) THEN
    RAISE EXCEPTION 'accounting: already reversed' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account', account_code,
           'debit', CASE WHEN credit > 0 THEN credit END, 'credit', CASE WHEN debit > 0 THEN debit END,
           'mva_code', mva_code, 'mva_role', mva_role, 'description', description, 'party', party, 'ref', ref)) ORDER BY line_no)
    INTO lines FROM accounting.voucher_lines WHERE voucher_id = p_voucher;
  v := accounting.insert_voucher(o.ledger_id, coalesce(p_date, (now() AT TIME ZONE 'Europe/Oslo')::date),
         'Reversal of ' || o.year || '-' || o.number || ': ' || btrim(p_reason), 'reversal', NULL, lines, p_voucher);
  PERFORM accounting.log(o.ledger_id, 'voucher.reversed', jsonb_build_object('voucher', p_voucher, 'by', v.id, 'reason', p_reason));
  RETURN v;
END $$;

-- Closing a period: nothing is posted on or before the date afterwards.
CREATE OR REPLACE FUNCTION accounting.lock_period(p_ledger uuid, p_until date)
RETURNS accounting.ledgers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']);
BEGIN
  IF p_until IS NULL OR p_until >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: only a period that has ended can be closed' USING ERRCODE = '22023';
  END IF;
  IF l.locked_until IS NOT NULL AND p_until <= l.locked_until THEN
    RAISE EXCEPTION 'accounting: already closed up to %', l.locked_until USING ERRCODE = '55000';
  END IF;
  UPDATE accounting.ledgers SET locked_until = p_until WHERE id = p_ledger RETURNING * INTO l;
  PERFORM accounting.log(p_ledger, 'ledger.locked', jsonb_build_object('until', p_until));
  RETURN l;
END $$;

-- Year end: the year's result moves from the income statement to equity
-- (debit 8800, credit 2050, or the reverse for a loss), dated 31 December.
CREATE OR REPLACE FUNCTION accounting.close_year(p_ledger uuid, p_year integer)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); v_result numeric; v_out accounting.vouchers%ROWTYPE;
BEGIN
  IF make_date(p_year, 12, 31) >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: the year has not ended' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = 'year_end' AND year = p_year) THEN
    RAISE EXCEPTION 'accounting: % is already closed', p_year USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO v_result
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code >= '3' AND v.year = p_year;
  IF v_result = 0 THEN RAISE EXCEPTION 'accounting: no result to close for %', p_year USING ERRCODE = '55000'; END IF;
  v_out := accounting.insert_voucher(p_ledger, make_date(p_year, 12, 31), 'Årsavslutning ' || p_year, 'year_end', NULL,
         jsonb_build_array(accounting.line(accounting.account_for(p_ledger, 'year_result'), v_result, NULL, NULL, 'Årsresultat'),
                           accounting.line(accounting.account_for(p_ledger, 'equity'), -v_result, NULL, NULL, 'Overført annen egenkapital')));
  PERFORM accounting.log(p_ledger, 'ledger.year_closed', jsonb_build_object('year', p_year, 'result', v_result));
  RETURN v_out;
END $$;

-- A receipt for a voucher: the file is in the private bucket under the
-- ledger's folder; its hash is kept with it.
CREATE OR REPLACE FUNCTION accounting.add_attachment(p_voucher uuid, p_path text, p_file_name text, p_sha256 text, p_size bigint)
RETURNS accounting.attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o accounting.vouchers%ROWTYPE; a accounting.attachments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM accounting.vouchers WHERE id = p_voucher;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting: no such voucher' USING ERRCODE = '42704'; END IF;
  PERFORM accounting.require_role(o.ledger_id, ARRAY['owner', 'accountant', 'bookkeeper']);
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> o.ledger_id::text OR p_path LIKE '%..%' THEN
    RAISE EXCEPTION 'accounting: the file belongs in the ledger''s folder' USING ERRCODE = '22023';
  END IF;
  INSERT INTO accounting.attachments (voucher_id, storage_path, file_name, sha256, size_bytes, uploaded_by)
  VALUES (p_voucher, p_path, btrim(p_file_name), lower(p_sha256), p_size, auth.uid()) RETURNING * INTO a;
  PERFORM accounting.log(o.ledger_id, 'voucher.attachment', jsonb_build_object('voucher', p_voucher, 'file', p_file_name, 'sha256', a.sha256));
  RETURN a;
END $$;


-- The income in a period (accounts 3xxx, without the year-end transfer):
-- what a price by turnover reads.
CREATE OR REPLACE FUNCTION accounting.turnover(p_ledger uuid, p_from date, p_to date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(vl.credit - vl.debit), 0)
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code LIKE '3%' AND v.voucher_date BETWEEN p_from AND p_to;
$$;

-- ── 8. Reports ──────────────────────────────────────────────────────────────
-- Saldobalanse: per account, the balance before the period, its debits and
-- credits, and the balance after. Income statement accounts (3–8) start
-- each calendar year at zero.
CREATE OR REPLACE FUNCTION accounting.trial_balance(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (account_code text, account_name text, opening numeric, debit numeric, credit numeric, closing numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  WITH m AS (
    SELECT vl.account_code AS code,
           sum(CASE WHEN v.voucher_date < p_from AND (vl.account_code < '3' OR v.voucher_date >= date_trunc('year', p_from)::date)
                    THEN vl.debit - vl.credit ELSE 0 END) AS opening,
           sum(CASE WHEN v.voucher_date >= p_from THEN vl.debit ELSE 0 END) AS debit,
           sum(CASE WHEN v.voucher_date >= p_from THEN vl.credit ELSE 0 END) AS credit
      FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
     WHERE vl.ledger_id = p_ledger AND v.voucher_date <= p_to
     GROUP BY vl.account_code)
  SELECT m.code, a.name, m.opening, m.debit, m.credit, m.opening + m.debit - m.credit
    FROM m JOIN accounting.accounts a ON a.ledger_id = p_ledger AND a.code = m.code
   WHERE m.opening <> 0 OR m.debit <> 0 OR m.credit <> 0
   ORDER BY m.code;
END $$;

-- Hovedbok: every line in the period, by account.
CREATE OR REPLACE FUNCTION accounting.general_ledger(p_ledger uuid, p_from date, p_to date, p_account text DEFAULT NULL)
RETURNS TABLE (voucher_id uuid, voucher_no text, voucher_date date, description text, account_code text,
               debit numeric, credit numeric, mva_code text, line_description text, party text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  SELECT v.id, v.year || '-' || v.number, v.voucher_date, v.description, vl.account_code, vl.debit, vl.credit, vl.mva_code,
         vl.description, vl.party
    FROM accounting.vouchers v JOIN accounting.voucher_lines vl ON vl.voucher_id = v.id
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND (p_account IS NULL OR vl.account_code = p_account)
   ORDER BY vl.account_code, v.voucher_date, v.year, v.number, vl.line_no;
END $$;

-- Resultatregnskap for a period (income positive), without the year-end
-- transfer.
CREATE OR REPLACE FUNCTION accounting.income_statement(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (grp text, account_code text, account_name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  RETURN QUERY
  SELECT CASE WHEN tb.account_code < '4' THEN '1 Driftsinntekter' WHEN tb.account_code < '8' THEN '2 Driftskostnader'
              ELSE '3 Finansposter og skatt' END,
         tb.account_code, tb.account_name, tb.credit - tb.debit
    FROM accounting.trial_balance(p_ledger, p_from, p_to) tb
   WHERE tb.account_code >= '3' AND tb.account_code < '8800' AND tb.debit + tb.credit > 0
   ORDER BY tb.account_code;
END $$;

-- Balanse on a date. A result not yet closed into equity is its own line
-- under equity, so the balance sheet balances at any date.
CREATE OR REPLACE FUNCTION accounting.balance_sheet(p_ledger uuid, p_at date)
RETURNS TABLE (grp text, account_code text, account_name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result numeric;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO v_result
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.account_code >= '3' AND v.voucher_date <= p_at;
  RETURN QUERY
  SELECT CASE WHEN x.code < '2' THEN '1 Eiendeler' WHEN x.code < '21' THEN '2 Egenkapital' ELSE '3 Gjeld' END,
         x.code, a.name, CASE WHEN x.code < '2' THEN x.bal ELSE -x.bal END
    FROM (SELECT vl.account_code AS code, sum(vl.debit - vl.credit) AS bal
            FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
           WHERE vl.ledger_id = p_ledger AND vl.account_code < '3' AND v.voucher_date <= p_at
           GROUP BY vl.account_code HAVING sum(vl.debit - vl.credit) <> 0) x
    JOIN accounting.accounts a ON a.ledger_id = p_ledger AND a.code = x.code
  UNION ALL
  SELECT '2 Egenkapital', NULL, 'Resultat som ikke er disponert', v_result WHERE v_result <> 0
  ORDER BY 1, 2 NULLS LAST;
END $$;

-- The dates of an MVA term: 1–6 (two months each) or 1 (the year).
CREATE OR REPLACE FUNCTION accounting.mva_term_dates(p_term_kind text, p_year integer, p_term integer)
RETURNS TABLE (term_from date, term_to date)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_term_kind = 'yearly' THEN make_date(p_year, 1, 1) ELSE make_date(p_year, p_term * 2 - 1, 1) END,
         CASE WHEN p_term_kind = 'yearly' THEN make_date(p_year, 12, 31)
              ELSE (make_date(p_year, p_term * 2 - 1, 1) + interval '2 months' - interval '1 day')::date END;
$$;

-- The MVA return for a term, per standard code: the basis and the MVA, each
-- signed so credit notes reduce them (output: credit − debit; input:
-- debit − credit).
CREATE OR REPLACE FUNCTION accounting.mva_report(p_ledger uuid, p_year integer, p_term integer)
RETURNS TABLE (mva_code text, description text, direction text, rate numeric, basis numeric, mva numeric, term_from date, term_to date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE; d record;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT * INTO l FROM accounting.ledgers WHERE id = p_ledger;
  IF (l.mva_term = 'yearly' AND p_term <> 1) OR (l.mva_term = 'bimonthly' AND p_term NOT BETWEEN 1 AND 6) THEN
    RAISE EXCEPTION 'accounting: term % does not exist for a % return', p_term, l.mva_term USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM accounting.mva_term_dates(l.mva_term, p_year, p_term);
  RETURN QUERY
  SELECT c.code, c.description, c.direction, c.rate,
         coalesce(sum(CASE WHEN vl.mva_role = 'basis' THEN CASE WHEN c.direction = 'input' THEN vl.debit - vl.credit ELSE vl.credit - vl.debit END END), 0),
         coalesce(sum(CASE WHEN vl.mva_role = 'vat'   THEN CASE WHEN c.direction = 'input' THEN vl.debit - vl.credit ELSE vl.credit - vl.debit END END), 0),
         d.term_from, d.term_to
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id JOIN accounting.mva_codes c ON c.code = vl.mva_code
   WHERE vl.ledger_id = p_ledger AND v.voucher_date BETWEEN d.term_from AND d.term_to
   GROUP BY c.code, c.description, c.direction, c.rate, c.sort
   ORDER BY c.sort;
END $$;

-- The MVA settlement for a term: the term's MVA moves from the MVA
-- accounts to the settlement account (2740), whose balance is then what is
-- paid to, or refunded by, Skatteetaten. Once per term.
CREATE OR REPLACE FUNCTION accounting.settle_mva(p_ledger uuid, p_year integer, p_term integer)
RETURNS accounting.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l accounting.ledgers%ROWTYPE := accounting.require_role(p_ledger, ARRAY['owner', 'accountant']); d record; r record;
        lines jsonb := '[]'::jsonb; total numeric := 0; v_source uuid; v_out accounting.vouchers%ROWTYPE;
BEGIN
  IF (l.mva_term = 'yearly' AND p_term <> 1) OR (l.mva_term = 'bimonthly' AND p_term NOT BETWEEN 1 AND 6) THEN
    RAISE EXCEPTION 'accounting: term % does not exist for a % return', p_term, l.mva_term USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM accounting.mva_term_dates(l.mva_term, p_year, p_term);
  IF d.term_to >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
    RAISE EXCEPTION 'accounting: the term has not ended' USING ERRCODE = '22023';
  END IF;
  v_source := md5(p_ledger::text || ':mva:' || p_year || ':' || p_term)::uuid;
  IF EXISTS (SELECT 1 FROM accounting.vouchers WHERE ledger_id = p_ledger AND source_type = 'mva_settlement' AND source_id = v_source) THEN
    RAISE EXCEPTION 'accounting: the term is already settled' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT vl.account_code, sum(vl.credit - vl.debit) AS bal
             FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
            WHERE vl.ledger_id = p_ledger AND vl.mva_role = 'vat' AND v.voucher_date BETWEEN d.term_from AND d.term_to
            GROUP BY vl.account_code HAVING sum(vl.credit - vl.debit) <> 0 ORDER BY vl.account_code LOOP
    lines := lines || accounting.line(r.account_code, r.bal, NULL, NULL, 'Mva-oppgjør');
    total := total + r.bal;
  END LOOP;
  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'accounting: no MVA in the term' USING ERRCODE = '55000'; END IF;
  lines := lines || accounting.line(accounting.account_for(p_ledger, 'vat_settlement'), -total, NULL, NULL,
                                    CASE WHEN total >= 0 THEN 'Skyldig mva' ELSE 'Mva til gode' END);
  v_out := accounting.insert_voucher(p_ledger, d.term_to,
         'Mva-oppgjør ' || p_year || CASE WHEN l.mva_term = 'yearly' THEN ' (år)' ELSE ' termin ' || p_term END,
         'mva_settlement', v_source, lines);
  PERFORM accounting.log(p_ledger, 'mva.settled', jsonb_build_object('year', p_year, 'term', p_term, 'payable', total));
  RETURN v_out;
END $$;

-- Checks the accountant looks at first, for a period: every voucher
-- balances, numbers have no gaps, vouchers without a receipt (manual ones),
-- and the MVA accounts agree with the MVA report.
CREATE OR REPLACE FUNCTION accounting.review_checks(p_ledger uuid, p_from date, p_to date)
RETURNS TABLE (check_name text, ok boolean, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n bigint; g text; vat_lines numeric; vat_accounts numeric;
BEGIN
  PERFORM accounting.require_reader(p_ledger);
  SELECT count(*) INTO n FROM accounting.vouchers v
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to
     AND (SELECT sum(debit) - sum(credit) FROM accounting.voucher_lines WHERE voucher_id = v.id) <> 0;
  RETURN QUERY SELECT 'Every voucher balances', n = 0, n || ' unbalanced';

  SELECT string_agg(year || ': ' || (max_n - n_count) || ' missing', '; ') INTO g FROM (
    SELECT year, max(number) AS max_n, count(*) AS n_count
      FROM accounting.vouchers WHERE ledger_id = p_ledger GROUP BY year) s WHERE max_n <> n_count;
  RETURN QUERY SELECT 'Voucher numbers have no gaps', g IS NULL, coalesce(g, 'none missing');

  SELECT count(*) INTO n FROM accounting.vouchers v
   WHERE v.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND v.source_type = 'manual'
     AND NOT EXISTS (SELECT 1 FROM accounting.attachments a WHERE a.voucher_id = v.id);
  RETURN QUERY SELECT 'Manual vouchers have a receipt', n = 0, n || ' without a receipt';

  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO vat_lines
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND vl.mva_role = 'vat' AND v.voucher_date BETWEEN p_from AND p_to;
  SELECT coalesce(sum(vl.credit - vl.debit), 0) INTO vat_accounts
    FROM accounting.voucher_lines vl JOIN accounting.vouchers v ON v.id = vl.voucher_id
   WHERE vl.ledger_id = p_ledger AND v.voucher_date BETWEEN p_from AND p_to AND v.source_type <> 'mva_settlement'
     AND vl.account_code IN (SELECT account_code FROM accounting.posting_accounts
                              WHERE ledger_id = p_ledger AND key ~ '^(output|input)_vat_');
  RETURN QUERY SELECT 'MVA accounts agree with the MVA lines', vat_lines = vat_accounts,
                      'MVA lines ' || vat_lines || ', MVA accounts ' || vat_accounts;

  SELECT string_agg(DISTINCT a.code, ', ') INTO g FROM accounting.accounts a
   WHERE a.ledger_id = p_ledger AND a.grouping_code IS NULL
     AND EXISTS (SELECT 1 FROM accounting.voucher_lines vl WHERE vl.ledger_id = p_ledger AND vl.account_code = a.code);
  RETURN QUERY SELECT 'Accounts in use have a tax-return grouping (SAF-T)', g IS NULL, coalesce('missing: ' || g, 'all mapped');
END $$;


-- ── 9. Receipts bucket (private; files are never replaced or removed) ──────
CREATE OR REPLACE FUNCTION accounting.path_access(p_name text, p_upload boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_folder text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN accounting.can_read(v_folder::uuid)
     AND (NOT p_upload OR EXISTS (SELECT 1 FROM accounting.ledgers WHERE id = v_folder::uuid AND status = 'active'));
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'ledger-attachments', 'ledger-attachments', false, 10485760,
       ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'application/xml', 'text/xml']
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ledger-attachments');
DROP POLICY IF EXISTS accounting_attachments_read ON storage.objects;
CREATE POLICY accounting_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ledger-attachments' AND accounting.path_access(name, false));
DROP POLICY IF EXISTS accounting_attachments_upload ON storage.objects;
CREATE POLICY accounting_attachments_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ledger-attachments' AND accounting.path_access(name, true));


-- ── 10. What clients may call ───────────────────────────────────────────────
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA accounting FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  accounting.can_read(uuid), accounting.role_of(uuid), accounting.can_manage(uuid), accounting.path_access(text, boolean),
  accounting.invite(uuid, text, text, text, text, date), accounting.accept_invitation(text), accounting.revoke_invitation(uuid),
  accounting.update_member(uuid, uuid, text, date), accounting.remove_member(uuid, uuid, text),
  accounting.add_note(uuid, uuid, text), accounting.my_ledgers(),
  accounting.request_ledger(uuid, date, text, numeric), accounting.decide_ledger(uuid, boolean, numeric, text),
  accounting.open_house_ledger(text, text, date, text), accounting.set_settings(uuid, jsonb),
  accounting.save_account(uuid, text, text, text, boolean, text, text), accounting.set_posting_account(uuid, text, text),
  accounting.end_ledger(uuid, text), accounting.post_voucher(uuid, date, text, jsonb),
  accounting.reverse_voucher(uuid, date, text), accounting.lock_period(uuid, date), accounting.close_year(uuid, integer),
  accounting.add_attachment(uuid, text, text, text, bigint), accounting.trial_balance(uuid, date, date),
  accounting.general_ledger(uuid, date, date, text), accounting.income_statement(uuid, date, date),
  accounting.balance_sheet(uuid, date), accounting.mva_term_dates(text, integer, integer),
  accounting.mva_report(uuid, integer, integer), accounting.settle_mva(uuid, integer, integer),
  accounting.review_checks(uuid, date, date),
  -- The adapter is called inside policies, as the caller.
  accounting.host_can_keep(uuid), accounting.host_can_manage(uuid), accounting.host_is_operator()
  TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA accounting TO service_role;
