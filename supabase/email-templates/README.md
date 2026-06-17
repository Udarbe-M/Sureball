# SureBall Email Templates

These files are ready to use for the Supabase `Confirm sign up` email template.

The HTML template is styled to look more polished in common inboxes and uses an email-safe table layout with inline styles.

## Files

- `confirm-signup-subject.txt`
- `confirm-signup.html`

## How to apply in Supabase

For hosted Supabase projects:

1. Open `Authentication` > `Email Templates`.
2. Select `Confirm sign up`.
3. Set the subject to the contents of `confirm-signup-subject.txt`.
4. Set the HTML body to the contents of `confirm-signup.html`.
5. Save the template.

This template uses:

- `{{ .ConfirmationURL }}` for the email verification link
- `{{ .Email }}` for the recipient email
- `{{ .Data.player_name }}` from the app signup metadata

## Optional redirect

If you want verification emails to send users to a specific URL after confirmation, set one of:

- `EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO`
- `expo.extra.supabaseEmailRedirectTo` in `frontend/app.json`

Make sure the same URL is added to your Supabase Auth redirect allow list.

## Sign in before verification

The app now attempts to sign the user in immediately after email signup. To allow that flow in hosted Supabase, open `Authentication` > `Providers` > `Email` and turn off required email confirmation. Supabase treats those new users as confirmed immediately; with required confirmation enabled, Supabase blocks password sign-in until the email link is clicked, and client-side app code cannot bypass that block.

Keep this template applied if the project keeps confirmation enabled or if you later add a separate verification/reminder flow.

## Delivery note

Supabase's default email provider is only meant for limited testing. For non-team users in the APK, configure `Authentication > SMTP Settings` with a custom provider, otherwise confirmation emails may never be delivered.
