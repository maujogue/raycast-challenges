import { useEffect, useMemo, useRef } from "react";
import { Action, ActionPanel, Form, Icon, List, Toast, showToast, open, useNavigation } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { supabase } from "./lib/supabase";
import { generateUUID } from "./lib/uuid";
import { BingoCell, computeScore } from "./types/bingo";

type StatusFilter = "all" | "validated" | "todo";

const GRID_SIZE = 25;

function createDefaultCells(): BingoCell[] {
  return Array.from({ length: GRID_SIZE }, (_, index) => ({
    id: `cell-${index + 1}`,
    text: `Icebreaker ${index + 1}`,
    prompt: undefined,
    status: "todo",
  }));
}

export default function Command() {
  const [localCells, setLocalCells] = useCachedState<BingoCell[]>("bingo-grid-cells", createDefaultCells());
  const [selectedBingoId] = useCachedState<string>("selected-bingo-id", "");
  const [participantKey, setParticipantKey] = useCachedState<string>("local-participant-key", "");
  const [participantDisplayName] = useCachedState<string>("participant-display-name", "Anonymous");

  const activeBingoId = selectedBingoId || "local";
  const [statusFilter, setStatusFilter] = useCachedState<StatusFilter>("view-grid-status-filter", "all");

  useEffect(() => {
    if (!participantKey) {
      setParticipantKey(generateUUID());
    }
  }, [participantKey, setParticipantKey]);

  const {
    data: remoteState,
    isLoading: isRemoteLoading,
    error: remoteError,
    mutate: refreshRemoteState,
  } = useCachedPromise(fetchRemoteGridState, [activeBingoId, participantKey, participantDisplayName], {
    execute: Boolean(activeBingoId && activeBingoId !== "local" && participantKey),
    keepPreviousData: true,
  });

  const isRemoteMode = Boolean(activeBingoId && activeBingoId !== "local");
  const allCells = isRemoteMode ? (remoteState?.cells ?? []) : localCells;
  const participantId = remoteState?.participantId ?? "";

  const cells = useMemo(() => {
    if (statusFilter === "all") return allCells;
    return allCells.filter((c) => c.status === statusFilter);
  }, [allCells, statusFilter]);

  const score = useMemo(() => computeScore(allCells), [allCells]);
  const hasShownWinnerToast = useRef(false);

  useEffect(() => {
    const isComplete = score.totalCells > 0 && score.completionRate === 1;
    if (isRemoteMode && isComplete) {
      if (!hasShownWinnerToast.current) {
        hasShownWinnerToast.current = true;
        showToast({
          style: Toast.Style.Success,
          title: "🎉 Bingo!",
          message: "You completed the grid! You're a winner!",
        });
        open("raycast://extensions/raycast/raycast/confetti");
      }
    } else if (score.completionRate < 1) {
      hasShownWinnerToast.current = false;
    }
  }, [isRemoteMode, score.completionRate, score.totalCells]);

  async function updateCellAnswer(cellId: string, nextText: string) {
    const safeText = nextText.trim();
    if (!safeText) return;

    if (isRemoteMode) {
      try {
        const { error } = await supabase.from("bingo_cells").update({ text: safeText }).eq("id", cellId);
        if (error) throw new Error(error.message);
        await refreshRemoteState();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unknown error";
        await showToast({ style: Toast.Style.Failure, title: "Unable to save answer", message });
      }
      return;
    }
    setLocalCells((prev) => prev.map((cell) => (cell.id === cellId ? { ...cell, text: safeText } : cell)));
  }

  async function toggleCellStatus(cellId: string) {
    if (isRemoteMode) {
      if (!activeBingoId || !participantId) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Unable to update status",
          message: "Missing participant context",
        });
        return;
      }

      const currentCell = cells.find((cell) => cell.id === cellId);
      if (!currentCell) {
        return;
      }

      const nextStatus = currentCell.status === "validated" ? "todo" : "validated";

      try {
        const { error } = await supabase.from("bingo_progress").upsert(
          {
            bingo_id: activeBingoId,
            participant_id: participantId,
            cell_id: cellId,
            status: nextStatus,
          },
          { onConflict: "participant_id,cell_id" },
        );

        if (error) {
          throw new Error(error.message);
        }
        await refreshRemoteState();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unknown error";
        await showToast({ style: Toast.Style.Failure, title: "Unable to update status", message });
      }
      return;
    }

    setLocalCells((previous) =>
      previous.map((cell) =>
        cell.id === cellId ? { ...cell, status: cell.status === "validated" ? "todo" : "validated" } : cell,
      ),
    );
  }

  async function resetGrid() {
    if (isRemoteMode) {
      if (!activeBingoId || !participantId) {
        return;
      }

      try {
        const { error } = await supabase
          .from("bingo_progress")
          .delete()
          .eq("bingo_id", activeBingoId)
          .eq("participant_id", participantId);
        if (error) {
          throw new Error(error.message);
        }
        await refreshRemoteState();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unknown error";
        await showToast({ style: Toast.Style.Failure, title: "Unable to reset progress", message });
      }
      return;
    }

    setLocalCells(createDefaultCells());
  }

  return (
    <List
      isShowingDetail
      isLoading={isRemoteMode && isRemoteLoading}
      searchBarPlaceholder={`Score: ${score.score}/${score.totalCells} (${Math.round(score.completionRate * 100)}%)`}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Status filter"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <List.Dropdown.Item value="all" title="All" />
          <List.Dropdown.Item value="validated" title="Validated" />
          <List.Dropdown.Item value="todo" title="To-do" />
        </List.Dropdown>
      }
    >
      {isRemoteMode && remoteError ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Unable to load bingo" description={remoteError.message} />
      ) : null}

      {isRemoteMode && !remoteError && !isRemoteLoading && allCells.length === 0 ? (
        <List.EmptyView
          icon={Icon.Circle}
          title="No cells for this bingo"
          description="Create cells from Manage Bingos or initialize the board schema script."
        />
      ) : null}

      {!remoteError && cells.length === 0 && allCells.length > 0 ? (
        <List.EmptyView
          icon={Icon.Circle}
          title={`No ${statusFilter} items`}
          description={`Try "All" or another status filter.`}
        />
      ) : null}

      {cells.map((cell) => {
        const promptTitle = cell.prompt?.trim() || "Challenge";
        return (
          <List.Item
            key={cell.id}
            icon={cell.status === "validated" ? Icon.Checkmark : Icon.Circle}
            title={promptTitle}
            accessories={[{ text: cell.status === "validated" ? "Validated" : "To-do" }]}
            detail={<List.Item.Detail markdown={cell.text || "_No answer yet_"} />}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Edit Answer"
                  icon={Icon.Pencil}
                  target={<EditAnswerForm cell={cell} onSubmit={updateCellAnswer} />}
                />
                <Action
                  title={cell.status === "validated" ? "Mark as to Complete" : "Mark as Validated"}
                  icon={cell.status === "validated" ? Icon.XMarkCircle : Icon.CheckCircle}
                  onAction={() => toggleCellStatus(cell.id)}
                />
                <Action
                  title={isRemoteMode ? "Reset My Progress" : "Reset Grid"}
                  style={Action.Style.Destructive}
                  icon={Icon.ArrowClockwise}
                  onAction={resetGrid}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function EditAnswerForm(props: { cell: BingoCell; onSubmit: (cellId: string, nextText: string) => Promise<void> }) {
  const { cell, onSubmit } = props;
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Answer"
            shortcut={{ modifiers: [], key: "return" }}
            onSubmit={async (values: { text: string }) => {
              await onSubmit(cell.id, values.text);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="text" title="Answer" defaultValue={cell.text} placeholder="Your answer" />
    </Form>
  );
}

async function fetchRemoteGridState(
  bingoId: string,
  participantKey: string,
  participantDisplayName: string,
): Promise<{ participantId: string; cells: BingoCell[] }> {
  const { data: participantData, error: participantError } = await supabase
    .from("bingo_participants")
    .upsert(
      {
        bingo_id: bingoId,
        participant_key: participantKey,
        display_name: participantDisplayName || "Anonymous",
      },
      { onConflict: "bingo_id,participant_key" },
    )
    .select("id")
    .single();

  if (participantError) {
    throw new Error(participantError.message);
  }

  const participantId = String(participantData.id);

  const { data: cellsData, error: cellsError } = await supabase
    .from("bingo_cells")
    .select("id,text,prompt,position")
    .eq("bingo_id", bingoId)
    .order("position", { ascending: true });

  if (cellsError) {
    throw new Error(cellsError.message);
  }

  const { data: progressData, error: progressError } = await supabase
    .from("bingo_progress")
    .select("cell_id,status")
    .eq("bingo_id", bingoId)
    .eq("participant_id", participantId);

  if (progressError) {
    throw new Error(progressError.message);
  }

  const progressByCell = new Map<string, string>();
  for (const row of progressData ?? []) {
    progressByCell.set(String(row.cell_id), String(row.status));
  }

  const cells: BingoCell[] = (cellsData ?? []).map((row) => ({
    id: String(row.id),
    text: String(row.text),
    prompt: row.prompt != null ? String(row.prompt) : undefined,
    status: progressByCell.get(String(row.id)) === "validated" ? "validated" : "todo",
  }));

  return { participantId, cells };
}
