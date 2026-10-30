import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { ANALYTICS_COMMANDS, InboxProposal } from "../engine/ipc";

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

const defaultInvoke: Invoke = (command, args) => tauriInvoke(command, args);

/**
 * Deletes every proposal file waiting in the MCP inbox
 * (`analytics-inbox/`, outside `main.db`), unreadable ones included. Used
 * when all club data is deleted: the next club must not find the old
 * club's proposals in the Explorer (review A, L5). True when the inbox is
 * empty afterwards; there is no inbox outside the desktop app.
 */
export const clearProposalsInbox = async (
  invoke: Invoke = defaultInvoke,
  desktop: boolean = isTauri()
): Promise<boolean> => {
  if (!desktop) return true;
  let proposals: InboxProposal[];
  try {
    proposals = await invoke<InboxProposal[]>(ANALYTICS_COMMANDS.inboxList);
  } catch (error) {
    console.error("❌ Could not list the proposals inbox", error);
    return false;
  }
  let cleared = true;
  for (const { id } of proposals) {
    try {
      await invoke<void>(ANALYTICS_COMMANDS.inboxRemove, { id });
    } catch (error) {
      console.error(`❌ Could not delete the proposal ${id}`, error);
      cleared = false;
    }
  }
  return cleared;
};
