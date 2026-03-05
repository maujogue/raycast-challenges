import { useEffect } from "react";
import { Action, ActionPanel, Form, Icon, List, Toast, showToast } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { supabase } from "./lib/supabase";
import { generateUUID } from "./lib/uuid";

interface BingoSearchResult {
  id: string;
  title: string;
  theme: string | null;
}

async function fetchBingos(): Promise<BingoSearchResult[]> {
  const { data, error } = await supabase
    .from("bingos")
    .select("id,title,theme")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "Untitled Bingo"),
    theme: row.theme ? String(row.theme) : null,
  }));
}

export default function Command() {
  const [participantKey, setParticipantKey] = useCachedState<string>("local-participant-key", "");
  const [displayName, setDisplayName] = useCachedState<string>("participant-display-name", "");
  const [, setSelectedBingoId] = useCachedState<string>("selected-bingo-id", "");

  useEffect(() => {
    if (!participantKey) {
      setParticipantKey(generateUUID());
    }
  }, [participantKey, setParticipantKey]);

  const {
    data: bingos = [],
    isLoading,
    error,
    mutate,
  } = useCachedPromise(fetchBingos, [], {
    keepPreviousData: true,
  });

  async function joinBingo(bingoId: string, values: { displayName: string }) {
    if (!participantKey) {
      await showToast({ style: Toast.Style.Failure, title: "Participant identity not ready yet" });
      return;
    }

    const trimmedName = values.displayName.trim();
    const nameToStore = trimmedName || "Anonymous";
    setDisplayName(nameToStore);

    const { error: joinError } = await supabase.from("bingo_participants").insert({
      bingo_id: bingoId,
      participant_key: participantKey,
      display_name: nameToStore,
    });

    if (joinError) {
      throw new Error(joinError.message);
    }

    setSelectedBingoId(bingoId);
  }

  async function runJoin(bingoId: string, values: { displayName: string }) {
    try {
      await joinBingo(bingoId, values);
      await mutate();
      await showToast({ style: Toast.Style.Success, title: "Joined bingo" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown error";
      await showToast({ style: Toast.Style.Failure, title: "Unable to join bingo", message });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search and join bingos">
      {error ? (
        <List.EmptyView title="Unable to load bingos" description={error.message} icon={Icon.ExclamationMark} />
      ) : null}
      {!error && !isLoading && bingos.length === 0 ? (
        <List.EmptyView
          title="No bingos available"
          description="Ask someone to create a bingo first."
          icon={Icon.Trophy}
        />
      ) : null}

      {!error &&
        bingos.map((bingo) => (
          <List.Item
            key={bingo.id}
            title={bingo.title}
            subtitle={bingo.theme ?? "No theme"}
            icon={Icon.MagnifyingGlass}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Join Bingo"
                  icon={Icon.Person}
                  target={<JoinBingoForm defaultName={displayName} onSubmit={(values) => runJoin(bingo.id, values)} />}
                />
                <Action.CopyToClipboard title="Copy Bingo ID" content={bingo.id} />
              </ActionPanel>
            }
          />
        ))}
    </List>
  );
}

function JoinBingoForm(props: { defaultName: string; onSubmit: (values: { displayName: string }) => Promise<void> }) {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Join" onSubmit={props.onSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="displayName" title="Display Name" defaultValue={props.defaultName} />
    </Form>
  );
}
