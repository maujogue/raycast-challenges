import { Icon, launchCommand, LaunchType, MenuBarExtra } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { fetchBingoOptions, fetchLeaderboard, getParticipantId } from "./lib/leaderboard";

async function resolveMenuBarState(
  selectedBingoId: string,
  participantKey: string,
): Promise<{ score: number; rank: number | null; title: string; activeBingoTitle: string }> {
  const bingos = await fetchBingoOptions();
  const activeBingoId = selectedBingoId || "local";

  if (activeBingoId === "local" || !activeBingoId) {
    return { score: 0, rank: null, title: "Local", activeBingoTitle: "Local grid" };
  }

  const activeBingo = bingos.find((b) => b.id === activeBingoId);
  const activeBingoTitle = activeBingo?.title ?? "Bingo";

  const [leaderboard, participantId] = await Promise.all([
    fetchLeaderboard(activeBingoId),
    getParticipantId(activeBingoId, participantKey),
  ]);

  const myIndex = participantId ? leaderboard.findIndex((e) => e.participantId === participantId) : -1;
  const rank = myIndex >= 0 ? myIndex + 1 : null;
  const score = myIndex >= 0 ? leaderboard[myIndex].score : 0;

  const title = rank !== null ? `${score} pts · #${rank}` : participantKey ? "Join a bingo" : "— pts · —";

  return { score, rank, title, activeBingoTitle };
}

export default function MenuBarCommand() {
  const [selectedBingoId] = useCachedState<string>("selected-bingo-id", "");
  const [participantKey] = useCachedState<string>("local-participant-key", "");

  const { data, isLoading } = useCachedPromise(resolveMenuBarState, [selectedBingoId, participantKey], {
    keepPreviousData: true,
  });

  const subtitle = data?.rank != null ? `Rank #${data.rank}` : "No rank";
  const scoreText = data?.score != null ? `${data.score} pts` : "—";

  return (
    <MenuBarExtra icon={Icon.Trophy} isLoading={isLoading} title={data?.title ?? "…"}>
      <MenuBarExtra.Item title={`Score: ${scoreText}`} subtitle={subtitle} />
      <MenuBarExtra.Item
        title={`Active: ${data?.activeBingoTitle ?? "…"}`}
        icon={Icon.AppWindow}
        onAction={() => launchCommand({ name: "manage-bingos", type: LaunchType.UserInitiated })}
      />
      <MenuBarExtra.Separator />
      <MenuBarExtra.Item
        title="View challenges"
        icon={Icon.Trophy}
        onAction={() => launchCommand({ name: "view-grid", type: LaunchType.UserInitiated })}
      />
      <MenuBarExtra.Item
        title="Check leaderboard"
        icon={Icon.Leaderboard}
        onAction={() => launchCommand({ name: "check-leaderboard", type: LaunchType.UserInitiated })}
      />
      <MenuBarExtra.Item
        title="Search bingos"
        icon={Icon.MagnifyingGlass}
        onAction={() => launchCommand({ name: "search-bingos", type: LaunchType.UserInitiated })}
      />
    </MenuBarExtra>
  );
}
