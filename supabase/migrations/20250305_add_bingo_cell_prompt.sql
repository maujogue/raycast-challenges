-- Add prompt column to bingo_cells for existing databases.
-- Skip if you bootstrap from schema.sql (it already includes prompt).

alter table public.bingo_cells add column if not exists prompt text;
