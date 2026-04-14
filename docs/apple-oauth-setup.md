# Apple OAuth setup for FlyttGo

The "Sign in with Apple" button in `AuthModal` calls
`supabase.auth.signInWithOAuth({ provider: 'apple' })`. Until the Apple
provider is enabled in Supabase Auth, clicking it will surface an
error like `"Unsupported provider: provider is not enabled"`.

This is the one-time setup to make it work.

## 1. Apple Developer Program prerequisites

You need an active Apple Developer Program membership ($99/yr).
Sign in to <https://developer.apple.com/account>.

## 2. Create an App ID

1. Go to **Certificates, Identifiers & Profiles → Identifiers**.
2. Click **+** → **App IDs** → **App**.
3. Description: `FlyttGo`. Bundle ID (explicit):
   `com.flyttgo.web` (or your preferred reverse-DNS).
4. Capabilities → enable **Sign In with Apple**.
5. Register.

## 3. Create a Services ID (this is the OAuth client ID)

1. **Identifiers** → **+** → **Services IDs** → Continue.
2. Description: `FlyttGo Web`. Identifier:
   `com.flyttgo.web.auth` (must be different from the App ID).
3. Register. Open it again, tick **Sign In with Apple** → Configure.
4. **Primary App ID**: select the App ID from step 2.
5. **Domains and Subdomains** — add every hostname that will host the
   sign-in UI. For this project:
   - `flyttgo.no` (production, once DNS is set up)
   - `flyttgo-a6ag.vercel.app`
   - `flyttgo-qo46.vercel.app`
   - `flyttgo-vk8t.vercel.app`
   - Any Git-branch preview hostnames you use regularly.
6. **Return URLs** — add the Supabase callback for your project:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   Find `<project-ref>` in Supabase Dashboard → Project Settings →
   Data API → "Project URL".
7. Save. Note the **Services ID identifier** — this is Supabase's
   "Client ID" in step 6.

## 4. Create a Sign In with Apple key

1. **Keys** → **+**.
2. Name: `FlyttGo Sign In with Apple`.
3. Tick **Sign In with Apple** → Configure → select the App ID from
   step 2 as the Primary App ID → Save → Continue → Register.
4. **Download the .p8 file now** — Apple only lets you download it
   once. Save it somewhere secure (password manager or secrets vault).
5. Record:
   - **Key ID** (10 characters, shown on the key's detail page)
   - **Team ID** (top-right of the developer portal, 10 characters)

## 5. Configure Supabase

1. Supabase Dashboard → your project → **Authentication → Providers**.
2. Scroll to **Apple** → toggle **Enable**.
3. Fill in:
   - **Client IDs**: the Services ID from step 3 (e.g.
     `com.flyttgo.web.auth`). Comma-separate if you add more.
   - **Secret Key (for OAuth)**: paste the *entire* contents of the
     .p8 file, including the `-----BEGIN PRIVATE KEY-----` / `-----END
     PRIVATE KEY-----` lines.
   - **Team ID**: the 10-character Team ID from step 4.
   - **Key ID**: the 10-character Key ID from step 4.
4. Save.

## 6. Allow the redirect URLs

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: your production URL (e.g. `https://flyttgo.no`).
- **Redirect URLs**: add every origin from step 3's Domains list —
  one per line, including the `https://` scheme. These must match
  exactly what the browser sends, otherwise Supabase will reject
  the callback.

## 7. Test

1. Open the site on one of the allowed origins.
2. Click "Sign in with Apple" in the auth modal.
3. Complete the Apple flow. You should land back on the site signed
   in, with a row in `auth.users` and a row in `auth.identities` with
   `provider = 'apple'`.

## Troubleshooting

- **`invalid_client`** in the Apple popup → the Services ID, Team ID,
  or .p8 key is wrong in Supabase.
- **`redirect_uri did not match`** → the return URL on Apple's side
  doesn't match the Supabase callback exactly (watch for trailing
  slashes).
- **"Unsupported provider"** in the FlyttGo modal → you haven't
  toggled Apple on in Supabase Auth → Providers.
- **Callback loops back to sign-in screen** → the origin isn't in
  Supabase's Redirect URLs allow-list.
- **Users sign in but no `profile` row is created** → the frontend
  signup flow inserts into `public.profiles`, but OAuth users never
  run that flow. Decide whether to create an on-login trigger that
  inserts a minimal profile row, or to lazily create it the first
  time the user hits the Profile page.

## Notes on user metadata

Apple returns very little profile info, and *only* on the first sign-in:
the email and (optionally) the name. If the user taps "Hide My Email"
Apple will give Supabase a relay address like
`abc123@privaterelay.appleid.com` — that's the real email for all
purposes, route your outbound mail there.

The frontend's `signUp()` / `updateProfile()` paths work unchanged for
Apple users; what's missing is that we never fill in `first_name` /
`last_name` automatically. The Profile page lets the user set them
manually, which is fine for now.
