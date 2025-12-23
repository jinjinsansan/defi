# Supabase Activity Logging Setup

This guide explains how to provision Supabase so the activity log API (`/api/activity`) can persist signed events from the dApp. Follow the steps in order—no application code edits are required once the environment variables and database objects are in place.

## 1. Required Environment Variables

Populate the following keys wherever the Next.js app runs (local `.env.local`, Vercel project settings, etc.). The `NEXT_PUBLIC_*` values are only used to toggle UI sections, but keeping them in sync with the server values avoids confusion.

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase project URL (e.g. `https://xyz.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client | Publishable key (formerly anon key). Not used directly yet, but exposes whether the activity widget should render. |
| `SUPABASE_SECRET_KEY` | server (secret) | Secret key (formerly service_role key) used for signed inserts/selects. **Never expose to the client.** |

> Tip: When running locally, create `web/.env.local` and mirror the entries from `web/.env.example`.

## 2. Database Schema

1. Open the Supabase SQL editor.
2. Ensure the `pgcrypto` extension is available (needed for `gen_random_uuid()`):

```sql
create extension if not exists "pgcrypto" with schema public;
```

3. Create the `activity_logs` table:

```sql
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('guardian','swap','liquidity','staking','lending','system')),
  description text not null,
  tx_hash text,
  account text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists activity_logs_category_created_idx
  on public.activity_logs (category, created_at desc);
```

The schema matches the TypeScript definitions in `web/src/lib/activityLog.ts`, so keeping the column names identical is important (note: `tx_hash` uses snake_case while the UI maps it to `txHash`).

## 3. Row Level Security (optional but recommended)

Although the service-role key bypasses RLS, enabling it prevents accidental public writes if the anon key is ever used:

```sql
alter table public.activity_logs enable row level security;

create policy "Allow service role full access"
  on public.activity_logs
  for all
  to service_role
  using (true)
  with check (true);

create policy "Allow anon read"
  on public.activity_logs
  for select
  to anon
  using (true);
```

Adjust the policies if you need stricter separation (e.g., per-category filters).

## 4. Verification Checklist

- Insert a dummy record directly from the SQL editor to confirm timestamps and category validation work.
- Call `curl -X GET https://<your-project>.supabase.co/rest/v1/activity_logs?select=*` with the anon key to ensure read access (or hit `npm run dev` and open the dashboard activity widget).
- Trigger a real action (e.g., GuardianVault approval) and confirm a signed entry appears with the correct `account` and `tx_hash`.

Once these steps pass, the Next.js API route will automatically read/write logs using the configured service key, and the dashboard’s activity feed will start populating.
