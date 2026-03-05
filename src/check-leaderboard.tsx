import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { supabase } from "./lib/supabase";
import { LeaderboardEntry } from "./types/bingo";

interface BingoOption {
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

async function fetchBingoOptions(): Promise<BingoOption[]> {
  const { data, error } = await supabase.from("bingos").select("id,title").order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((bingo) => ({ id: String(bingo.id), title: String(bingo.title ?? "Untitled Bingo") }));
}

async function fetchLeaderboard(bingoId: string): Promise<LeaderboardEntry[]> {
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

export default function Command() {
  const [selectedBingoId] = useCachedState<string>("selected-bingo-id", "");

  const { data: bingos = [], isLoading: isLoadingBingos, error: bingosError } = useCachedPromise(fetchBingoOptions, []);

  const activeBingoId =
    selectedBingoId && selectedBingoId !== "local" ? selectedBingoId : bingos[0]?.id ?? "";
  const activeBingoTitle = bingos.find((bingo) => bingo.id === activeBingoId)?.title ?? "No Bingo Selected";

  const {
    data: leaderboard = [],
    isLoading: isLoadingLeaderboard,
    error: leaderboardError,
  } = useCachedPromise(fetchLeaderboard, [activeBingoId], {
    execute: Boolean(activeBingoId),
    keepPreviousData: true,
  });

  const isLoading = isLoadingBingos || isLoadingLeaderboard;
  const error = bingosError ?? leaderboardError;

  return (
    <List isLoading={isLoading} searchBarPlaceholder={activeBingoTitle}>
      {error ? (
        <List.EmptyView title="Unable to load leaderboard" description={error.message} icon={Icon.ExclamationMark} />
      ) : null}

      {!error && !isLoading && !activeBingoId ? (
        <List.EmptyView
          title="No bingo selected"
          description="Set an active bingo in Manage Bingos (⌘S)."
          icon={Icon.Circle}
        />
      ) : null}

      {!error && !isLoading && activeBingoId && leaderboard.length === 0 ? (
        <List.EmptyView
          title="No participants yet"
          description="Join this bingo to appear in the leaderboard."
          icon={Icon.Person}
        />
      ) : null}

      {!error &&
        leaderboard.map((entry, index) => (
          <List.Item
            key={entry.participantId}
            icon={index === 0 ? Icon.Trophy : Icon.Person}
            title={entry.displayName}
            subtitle={`Rank #${index + 1}`}
            accessories={[
              { text: `${entry.validatedCount} validated` },
              { icon: Icon.BarChart, text: `${entry.score} pts` },
            ]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard content={`${entry.displayName}: ${entry.score} pts`} />
              </ActionPanel>
            }
          />
        ))}
    </List>
  );
}
