-- Store each participant's answer per cell in bingo_progress so editing
-- a challenge only affects the current user, not everyone on the same grid.

alter table public.bingo_progress
  add column if not exists answer_text text;
