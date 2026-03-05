-- Allow more than 25 cells per bingo (position was previously restricted to 0..24).
alter table public.bingo_cells drop constraint if exists bingo_cells_position_check;
alter table public.bingo_cells add constraint bingo_cells_position_check check (position >= 0);
