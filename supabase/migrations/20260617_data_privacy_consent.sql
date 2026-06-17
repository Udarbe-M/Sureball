alter table public.profiles
add column if not exists data_privacy_consent_accepted boolean not null default false,
add column if not exists data_privacy_consent_accepted_at timestamptz,
add column if not exists data_privacy_consent_version text;
