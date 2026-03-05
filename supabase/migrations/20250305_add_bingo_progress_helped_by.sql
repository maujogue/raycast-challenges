-- Optional: who helped this participant fill this answer (another participant in the same bingo).
alter table public.bingo_progress
  add column if not exists helped_by_participant_id uuid references public.bingo_participants(id) on delete set null;

create index if not exists idx_bingo_progress_helped_by on public.bingo_progress(helped_by_participant_id);
