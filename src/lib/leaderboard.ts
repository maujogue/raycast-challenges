import { supabase } from "./supabase";
import { LeaderboardEntry } from "../types/bingo";

export interface BingoOption {
  id: string;
  title: string;
}

interface ParticipantRow {
  id: string;
  display_name: string | null;
}

interface ProgressRow {
  participant_id: string;
  status: string;
}

export async function fetchBingoOptions(): Promise<BingoOption[]> {
  const { data, error } = await supabase.from("bingos").select("id,title").order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((bingo) => ({ id: String(bingo.id), title: String(bingo.title ?? "Untitled Bingo") }));
}

export async function fetchLeaderboard(bingoId: string): Promise<LeaderboardEntry[]> {
  const { data: participantsData, error: participantsError } = await supabase
    .from("bingo_participants")
    .select("id,display_name")
    .eq("bingo_id", bingoId);

  if (participantsError) {
    throw new Error(participantsError.message);
  }

  const { data: progressData, error: progressError } = await supabase
    .from("bingo_progress")
    .select("participant_id,status")
    .eq("bingo_id", bingoId)
    .eq("status", "validated");

  if (progressError) {
    throw new Error(progressError.message);
  }

  const participants = (participantsData ?? []) as ParticipantRow[];
  const progress = (progressData ?? []) as ProgressRow[];

  const validatedByParticipant = progress.reduce<Map<string, number>>((accumulator, row) => {
    const previous = accumulator.get(row.participant_id) ?? 0;
    accumulator.set(row.participant_id, previous + 1);
    return accumulator;
  }, new Map<string, number>());

  return participants
    .map((participant) => {
      const validatedCount = validatedByParticipant.get(participant.id) ?? 0;
      return {
        participantId: participant.id,
        displayName: participant.display_name || "Anonymous",
        validatedCount,
        score: validatedCount,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Get current user's participant id for a bingo (by participant_key). Returns null if not joined. */
export async function getParticipantId(bingoId: string, participantKey: string): Promise<string | null> {
  if (!bingoId || !participantKey) {
    return null;
  }

  const { data, error } = await supabase
    .from("bingo_participants")
    .select("id")
    .eq("bingo_id", bingoId)
    .eq("participant_key", participantKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? String(data.id) : null;
}
