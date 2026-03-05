import { useEffect } from "react";
import { Action, ActionPanel, Form, Icon, Keyboard, List, Toast, showToast, useNavigation } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { supabase } from "./lib/supabase";
import { generateUUID } from "./lib/uuid";
import { BingoCell } from "./types/bingo";

const LOCAL_GRID_SIZE = 25;

function createDefaultLocalCells(): BingoCell[] {
  return Array.from({ length: LOCAL_GRID_SIZE }, (_, index) => ({
    id: `cell-${index + 1}`,
    text: `Icebreaker ${index + 1}`,
    prompt: undefined,
    status: "todo",
  }));
}

interface BingoSummary {
  id: string;
  title: string;
  theme: string | null;
  owner_id: string;
}

type BingoFilter = "all" | "mine";

async function fetchOwnedBingos(ownerId: string): Promise<BingoSummary[]> {
  if (!ownerId) return [];
  const { data, error } = await supabase
    .from("bingos")
    .select("id,title,theme,owner_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "Untitled Bingo"),
    theme: row.theme ? String(row.theme) : null,
    owner_id: String(row.owner_id),
  }));
}

async function fetchJoinedBingos(participantKey: string): Promise<BingoSummary[]> {
  if (!participantKey) return [];
  const { data: participantsData, error: participantsError } = await supabase
    .from("bingo_participants")
    .select("bingo_id")
    .eq("participant_key", participantKey);

  if (participantsError) {
    throw new Error(participantsError.message);
  }
  if (!participantsData?.length) return [];

  const bingoIds = participantsData.map((r) => r.bingo_id);
  const { data: bingosData, error: bingosError } = await supabase
    .from("bingos")
    .select("id,title,theme,owner_id")
    .in("id", bingoIds)
    .order("created_at", { ascending: false });

  if (bingosError) {
    throw new Error(bingosError.message);
  }

  return (bingosData ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "Untitled Bingo"),
    theme: row.theme ? String(row.theme) : null,
    owner_id: String(row.owner_id),
  }));
}

export default function Command() {
  const [ownerId, setOwnerId] = useCachedState<string>("local-owner-id", "");
  const [participantKey, setParticipantKey] = useCachedState<string>("local-participant-key", "");
  const [selectedBingoId, setSelectedBingoId] = useCachedState<string>("selected-bingo-id", "");
  const [bingoFilter, setBingoFilter] = useCachedState<BingoFilter>("manage-bingos-filter", "all");
  const [, setLocalGridCells] = useCachedState<BingoCell[]>("bingo-grid-cells", createDefaultLocalCells());

  useEffect(() => {
    if (!ownerId) {
      setOwnerId(generateUUID());
    }
  }, [ownerId, setOwnerId]);

  useEffect(() => {
    if (!participantKey) {
      setParticipantKey(generateUUID());
    }
  }, [participantKey, setParticipantKey]);

  const {
    data: ownedBingos = [],
    isLoading: isOwnedLoading,
    error: ownedError,
    mutate: mutateOwned,
  } = useCachedPromise(fetchOwnedBingos, [ownerId], {
    execute: Boolean(ownerId),
    keepPreviousData: true,
  });

  const {
    data: joinedBingos = [],
    isLoading: isJoinedLoading,
    error: joinedError,
    mutate: mutateJoined,
  } = useCachedPromise(fetchJoinedBingos, [participantKey], {
    execute: Boolean(participantKey),
    keepPreviousData: true,
  });

  const ownedIds = new Set(ownedBingos.map((b) => b.id));
  const allBingos = [
    ...ownedBingos,
    ...joinedBingos.filter((b) => !ownedIds.has(b.id)),
  ];

  const bingos =
    bingoFilter === "mine" ? allBingos.filter((b) => b.owner_id === ownerId) : allBingos;
  const isLoading = isOwnedLoading || isJoinedLoading;
  const error = ownedError ?? joinedError;

  async function mutate() {
    await Promise.all([mutateOwned(), mutateJoined()]);
  }

  function parsePrompts(promptsText: string, count: number): { text: string; prompt: string | null }[] {
    const lines = promptsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from({ length: count }, (_, i) => {
      const line = lines[i] ?? "";
      return { text: line || `Entry ${i + 1}`, prompt: line || null };
    });
  }

  async function handleCreate(values: { title: string; theme: string; itemCount: string; prompts: string }) {
    if (!ownerId) {
      await showToast({ style: Toast.Style.Failure, title: "Owner identity not ready yet" });
      return;
    }

    const count = parseInt(values.itemCount, 10) || 25;
    const entries = parsePrompts(values.prompts.trim(), count);

    const { data: bingoData, error: bingoError } = await supabase
      .from("bingos")
      .insert({
        title: values.title.trim(),
        theme: values.theme.trim() || null,
        owner_id: ownerId,
      })
      .select("id")
      .single();

    if (bingoError) {
      throw new Error(bingoError.message);
    }

    const bingoId = String(bingoData.id);
    const defaultCells = entries.map((entry, index) => ({
      bingo_id: bingoId,
      text: entry.text,
      prompt: entry.prompt,
      position: index,
    }));

    const { error: cellsError } = await supabase.from("bingo_cells").insert(defaultCells);
    if (cellsError) {
      throw new Error(cellsError.message);
    }
  }

  async function handleUpdate(
    bingoId: string,
    values: { title: string; theme: string; itemCount: string; prompts: string },
  ) {
    const { error: updateError } = await supabase
      .from("bingos")
      .update({
        title: values.title.trim(),
        theme: values.theme.trim() || null,
      })
      .eq("id", bingoId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const count = parseInt(values.itemCount, 10) || 25;
    const entries = parsePrompts(values.prompts.trim(), count);

    const { error: deleteError } = await supabase.from("bingo_cells").delete().eq("bingo_id", bingoId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const newCells = entries.map((entry, index) => ({
      bingo_id: bingoId,
      text: entry.text,
      prompt: entry.prompt,
      position: index,
    }));
    const { error: insertError } = await supabase.from("bingo_cells").insert(newCells);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  async function runAndRefresh(action: () => Promise<void>, successMessage: string) {
    try {
      await action();
      await mutate();
      await showToast({ style: Toast.Style.Success, title: successMessage });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown error";
      await showToast({ style: Toast.Style.Failure, title: "Operation failed", message });
    }
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Manage your bingos"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter"
          value={bingoFilter}
          onChange={(value) => setBingoFilter(value as BingoFilter)}
        >
          <List.Dropdown.Item value="all" title="All (yours + joined)" />
          <List.Dropdown.Item value="mine" title="Mine only" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Create Bingo"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={<CreateBingoForm onSubmit={handleCreateAndRefresh} />}
          />
        </ActionPanel>
      }
    >
      {error ? (
        <List.EmptyView title="Unable to load bingos" description={error.message} icon={Icon.ExclamationMark} />
      ) : null}
      {!error && !isLoading && bingos.length === 0 ? (
        <List.EmptyView
          title={bingoFilter === "mine" ? "No bingos you own" : "No bingos yet"}
          description={
            bingoFilter === "mine"
              ? "Create one or switch to “All” to see joined bingos."
              : "Create your first bingo or join one from Search Bingos."
          }
          icon={Icon.Circle}
        />
      ) : null}

      <List.Item
        title="Local grid"
        subtitle={selectedBingoId === "local" ? "Active in View challenges / Leaderboard" : "Set as active bingo"}
        icon={Icon.AppWindowGrid3x3}
        accessories={selectedBingoId === "local" ? [{ icon: Icon.Checkmark }] : []}
        actions={
          <ActionPanel>
            <Action
              title="Set as Active Bingo"
              icon={Icon.Checkmark}
              onAction={async () => {
                setSelectedBingoId("local");
                await showToast({ style: Toast.Style.Success, title: "Local grid is now active" });
              }}
            />
            <Action
              title="Delete Local Grid"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={async () => {
                setLocalGridCells(createDefaultLocalCells());
                await showToast({ style: Toast.Style.Success, title: "Local grid deleted (reset to default)" });
              }}
            />
            <Action.Push
              title="Create Bingo"
              icon={Icon.Plus}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<CreateBingoForm onSubmit={handleCreateAndRefresh} />}
            />
          </ActionPanel>
        }
      />

      {!error &&
        bingos.map((bingo) => {
          const isOwned = bingo.owner_id === ownerId;
          return (
            <List.Item
              key={bingo.id}
              title={bingo.title}
              subtitle={
                selectedBingoId === bingo.id
                  ? "Active in View challenges / Leaderboard"
                  : [bingo.theme ?? "No theme", isOwned ? "Yours" : "Joined"].filter(Boolean).join(" · ")
              }
              icon={Icon.Circle}
              accessories={[
                ...(selectedBingoId === bingo.id ? [{ icon: Icon.Checkmark }] : []),
                { text: isOwned ? "Yours" : "Joined" },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="Set as Active Bingo"
                    icon={Icon.Checkmark}
                    onAction={async () => {
                      setSelectedBingoId(bingo.id);
                      await showToast({ style: Toast.Style.Success, title: `"${bingo.title}" is now active` });
                    }}
                  />
                  {isOwned ? (
                    <Action.Push
                      title="Edit Bingo"
                      shortcut={{ modifiers: ["cmd"], key: "e" }}
                      icon={Icon.Pencil}
                      target={
                        <EditBingoForm
                          bingoId={bingo.id}
                          bingo={bingo}
                          onSubmit={(values) => runAndRefresh(() => handleUpdate(bingo.id, values), "Bingo updated")}
                        />
                      }
                    />
                  ) : null}
                  <Action.Push
                    title="Create Bingo"
                    icon={Icon.Plus}
                    shortcut={Keyboard.Shortcut.Common.New}
                    target={<CreateBingoForm onSubmit={handleCreateAndRefresh} />}
                  />
                </ActionPanel>
              }
            />
          );
        })}
    </List>
  );

  async function handleCreateAndRefresh(values: { title: string; theme: string; itemCount: string; prompts: string }) {
    await runAndRefresh(() => handleCreate(values), "Bingo created");
  }
}

function CreateBingoForm(props: {
  onSubmit: (values: { title: string; theme: string; itemCount: string; prompts: string }) => Promise<void>;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Bingo"
            onSubmit={async (values: { title: string; theme: string; itemCount: string; prompts: string }) => {
              await props.onSubmit(values);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" placeholder="Raycast Meetup Bingo" />
      <Form.TextField id="theme" title="Theme" placeholder="Raycast Icebreakers" />
      <Form.Dropdown id="itemCount" title="Number of items" defaultValue="25">
        <Form.Dropdown.Item value="9" title="9 (3×3)" />
        <Form.Dropdown.Item value="16" title="16 (4×4)" />
        <Form.Dropdown.Item value="25" title="25 (5×5)" />
      </Form.Dropdown>
      <Form.TextArea
        id="prompts"
        title="Prompts (one per line)"
        placeholder={"Find someone who uses Raycast\nMeet a team member from another squad\n..."}
      />
    </Form>
  );
}

async function fetchBingoCells(bingoId: string): Promise<{ text: string; prompt: string | null }[]> {
  const { data, error } = await supabase
    .from("bingo_cells")
    .select("text,prompt,position")
    .eq("bingo_id", bingoId)
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    text: String(row.text),
    prompt: row.prompt != null ? String(row.prompt) : null,
  }));
}

function EditBingoForm(props: {
  bingoId: string;
  bingo: BingoSummary;
  onSubmit: (values: { title: string; theme: string; itemCount: string; prompts: string }) => Promise<void>;
}) {
  const { data: cells = [], isLoading } = useCachedPromise(fetchBingoCells, [props.bingoId]);
  const promptsDefault = cells.map((c) => c.prompt || c.text).join("\n");
  const itemCount = cells.length || 25;

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" onSubmit={props.onSubmit} />
        </ActionPanel>
      }
      isLoading={isLoading}
    >
      <Form.TextField id="title" title="Title" defaultValue={props.bingo.title} />
      <Form.TextField id="theme" title="Theme" defaultValue={props.bingo.theme ?? ""} />
      <Form.Dropdown id="itemCount" title="Number of items" defaultValue={String(itemCount)}>
        <Form.Dropdown.Item value="9" title="9 (3×3)" />
        <Form.Dropdown.Item value="16" title="16 (4×4)" />
        <Form.Dropdown.Item value="25" title="25 (5×5)" />
      </Form.Dropdown>
      <Form.TextArea
        id="prompts"
        title="Prompts (one per line)"
        defaultValue={promptsDefault}
        placeholder="One prompt per grid entry"
      />
    </Form>
  );
}
