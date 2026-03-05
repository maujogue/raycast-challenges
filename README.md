# Bingo!

A Raycast extension for meetup icebreaker bingo.

## Commands

- `View challenges`: edit your grid, mark cells validated/todo, and track your score.
- `Check Leaderboard`: show ranking for the selected bingo.
- `Manage Bingos`: create, edit, and delete bingos you own.
- `Search Bingos`: browse and join existing bingos.

## Supabase Setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor.
3. Create a local `.env` file with:

```bash
PROJECT_URL=https://<your-project>.supabase.co
SUPABASE_PUBLIC_KEY=<your-supabase-publishable-key>
```

The app also supports `SUPABASE_URL` and `SUPABASE_ANON_KEY` as fallback names.

## Local Development

```bash
npm install
npm run dev
```

## Notes

- In V1, AI completion is intentionally disabled.
- The current SQL policies are permissive for meetup velocity; tighten RLS once full user auth is added.
