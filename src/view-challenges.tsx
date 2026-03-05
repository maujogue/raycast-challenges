import { useEffect, useMemo, useRef } from "react";
import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  open,
  useNavigation,
  clearSearchBar,
} from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { supabase } from "./lib/supabase";
import { generateUUID } from "./lib/uuid";
import { BingoCell, computeScore } from "./types/bingo";

export type BingoParticipantOption = { id: string; displayName: string };

async function fetchBingoParticipants(bingoId: string): Promise<BingoParticipantOption[]> {
  const { data, error } = await supabase
    .from("bingo_participants")
    .select("id,display_name")
    .eq("bingo_id", bingoId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: String(r.id), displayName: r.display_name ?? "Anonymous" }));
}

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

  async function updateCellAnswer(cellId: string, nextText: string, helpedByParticipantId: string | null = null) {
    const safeText = nextText.trim();
    if (!safeText) return;

    if (isRemoteMode) {
      if (!activeBingoId || !participantId) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Unable to save answer",
          message: "Missing participant context",
        });
        return;
      }
      const currentCell = allCells.find((c) => c.id === cellId);
      try {
        const { error } = await supabase.from("bingo_progress").upsert(
          {
            bingo_id: activeBingoId,
            participant_id: participantId,
            cell_id: cellId,
            status: currentCell?.status ?? "todo",
            answer_text: safeText,
            helped_by_participant_id: helpedByParticipantId || null,
          },
          { onConflict: "participant_id,cell_id" },
        );
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
            answer_text: currentCell.text || null,
            helped_by_participant_id: currentCell.helpedByParticipantId ?? null,
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
            detail={
              <List.Item.Detail
                markdown={[
                  cell.text || "_No answer yet_",
                  cell.helpedByDisplayName ? `\n\n_Helped by: ${cell.helpedByDisplayName}_` : "",
                ].join("")}
              />
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="Edit Answer"
                  icon={Icon.Pencil}
                  target={
                    <EditAnswerForm
                      cell={cell}
                      bingoId={isRemoteMode ? activeBingoId : undefined}
                      onSubmit={updateCellAnswer}
                    />
                  }
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

function SelectHelperList(props: {
  bingoId: string;
  cellId: string;
  answerText: string;
  onSave: (cellId: string, answerText: string, helpedByParticipantId: string | null) => Promise<void>;
}) {
  const { bingoId, cellId, answerText, onSave } = props;
  const { data: participants = [], isLoading } = useCachedPromise(fetchBingoParticipants, [bingoId]);
  const { pop } = useNavigation();
  async function selectAndSave(helpedByParticipantId: string) {
    await onSave(cellId, answerText, helpedByParticipantId);
    pop();
    pop();
    await clearSearchBar();
  }

  return (
    <List searchBarPlaceholder="Search participants by name..." isLoading={isLoading}>
      {participants.map((p) => (
        <List.Item
          key={p.id}
          title={p.displayName}
          icon={Icon.Person}
          actions={
            <ActionPanel>
              <Action
                title="Save & Back to List"
                shortcut={{ modifiers: [], key: "return" }}
                onAction={() => selectAndSave(p.id)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function EditAnswerForm(props: {
  cell: BingoCell;
  bingoId?: string;
  onSubmit: (cellId: string, nextText: string, helpedByParticipantId: string | null) => Promise<void>;
}) {
  const { cell, bingoId, onSubmit } = props;
  const { push, pop } = useNavigation();

  const { data: participants = [] } = useCachedPromise(fetchBingoParticipants, [bingoId ?? ""], {
    execute: Boolean(bingoId),
  });
  const goToHelperStep = Boolean(bingoId && participants.length > 0);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={goToHelperStep ? "Next: Who Helped You?" : "Save Answer"}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onSubmit={async (values: { text: string }) => {
              const text = values.text.trim();
              if (!text) return;
              if (goToHelperStep) {
                push(<SelectHelperList bingoId={bingoId!} cellId={cell.id} answerText={text} onSave={onSubmit} />);
              } else {
                await onSubmit(cell.id, text, null);
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="text" title="Answer" defaultValue={cell.text} placeholder="Your answer" />
      {goToHelperStep && <Form.Description title="" text="Press Enter, then choose who helped you (search by name)." />}
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
    .select("cell_id,status,answer_text,helped_by_participant_id")
    .eq("bingo_id", bingoId)
    .eq("participant_id", participantId);

  if (progressError) {
    throw new Error(progressError.message);
  }

  const helpedByIds = [
    ...new Set((progressData ?? []).map((r) => r.helped_by_participant_id).filter(Boolean)),
  ] as string[];
  const participantDisplayByName = new Map<string, string>();
  if (helpedByIds.length > 0) {
    const { data: helpersData } = await supabase
      .from("bingo_participants")
      .select("id,display_name")
      .in("id", helpedByIds);
    for (const p of helpersData ?? []) {
      participantDisplayByName.set(String(p.id), p.display_name ?? "Anonymous");
    }
  }

  const progressByCell = new Map<
    string,
    { status: string; answer_text: string | null; helped_by_participant_id: string | null }
  >();
  for (const row of progressData ?? []) {
    const helpedById = row.helped_by_participant_id != null ? String(row.helped_by_participant_id) : null;
    progressByCell.set(String(row.cell_id), {
      status: String(row.status),
      answer_text: row.answer_text != null ? String(row.answer_text) : null,
      helped_by_participant_id: helpedById,
    });
  }

  const cells: BingoCell[] = (cellsData ?? []).map((row) => {
    const progress = progressByCell.get(String(row.id));
    const helpedById = progress?.helped_by_participant_id ?? null;
    return {
      id: String(row.id),
      text: progress?.answer_text ?? "",
      prompt: row.prompt != null ? String(row.prompt) : undefined,
      status: progress?.status === "validated" ? "validated" : "todo",
      helpedByParticipantId: helpedById ?? undefined,
      helpedByDisplayName: helpedById ? (participantDisplayByName.get(helpedById) ?? null) : undefined,
    };
  });

  return { participantId, cells };
}
