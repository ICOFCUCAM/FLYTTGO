# Contact inbox

Owner's decision, 2026-10-30 (platform audit, "Contact and corporate sales forms are stubs"; `DECISIONS.md` #55).

Three public forms used to say "sent" and send nothing. They now store what visitors send, and FlyttGo's administrators read it under **Admin → Inbox**.

| Form | Where | Required | Stored as |
|---|---|---|---|
| Contact | `/contact` (`ContactPage`) | name, email, message | source `contact`; topic = reason and subject |
| Corporate quote | `/business` (`CorporatePage`) | company, email | source `corporate`; topic = estimated monthly volume |
| Newsletter sign-up | every page's footer (`Footer`) | email | source `newsletter`; topic "Newsletter sign-up" (only the email is kept) |

A form shows its "sent" view only when the message was stored, and a clear error otherwise (the database's own wording for a refused field or the rate limit; a general message for anything else).

## How it is protected

- Table `public.contact_messages` (migration 00026): name, email, phone (optional), company (optional), topic/source, message, `created_at`, `status` (`new` or `handled`), `handled_by` and `handled_at` (always both set when handled).
- Nobody writes to the table directly. Visitors, signed in or not, call `submit_contact_message()`, which trims and checks every field (valid email of at most 254 characters, name at most 120, company and subject at most 200, message at most 5000, phone digits and `+ ( ) . -` only) and refuses more than **5 messages from one email address in an hour**, and more than **300 from everyone in 10 minutes**.
- Only FlyttGo administrators (`is_admin()`) can read the messages (row-level security); they mark one handled or back to new with `admin_set_contact_message_status()`, which records who and when.
- Tests: `supabase/tests/contact_messages.test.sql` (in both lists of `supabase/tests/run.sh`), the release rehearsal (`supabase/tests/rehearsal/`: 00026 up and down with messages in place) and `src/test/audit-fixes.test.tsx`.

## Email

No email is sent when a message arrives, and none is sent to the visitor. Email waits for Resend (the `RESEND_API_KEY` secret, `docs/PLATFORM_AUDIT_2026-10-30.md` → Secrets): until then an administrator checks Admin → Inbox and answers from their own mailbox (each message's email is a `mailto:` link). Once Resend is configured, a notification to support can be added in the pattern of `send-booking-email`.

The newsletter sign-ups are kept as a list only: no newsletter is sent from the platform, and there is no double opt-in yet. Before sending any newsletter, the consent wording and unsubscribe need the lawyer's review.

## Rollback

`supabase/rollback/00026_down.sql` drops the table and its functions: export any messages still to be answered first. The forms then show an error instead of "sent".
