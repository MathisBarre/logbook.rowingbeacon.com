import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { SavedQuery } from "../types";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import type { InvalidProposal } from "./useProposalsInbox";
import { mcpClientName } from "./mcpClientName";
import { formatStoredDate } from "./useQueryList";

/**
 * "Propositions" (plan 1.3): charts proposed through MCP by an AI app of
 * this computer (Claude Desktop, Claude Code, Codex, Cursor…), named by
 * its `clientInfo.name`. A card shows the title, who sent it and its
 * description, with Examiner (opens it full size in the editor, where a
 * banner offers Accepter and Refuser: review 43), Accepter and Refuser.
 * Unreadable files are listed with their reason.
 */

interface ProposalsProps {
  proposals: SavedQuery[] | null;
  invalid: InvalidProposal[];
  /** The proposal open in the editor, outlined. */
  currentId: string | null;
  /** MCP is turned on for this computer (else the empty text says how). */
  mcpEnabled: boolean;
  onExamine: (query: SavedQuery) => void;
  onAccept: (query: SavedQuery) => void;
  onRefuse: (query: SavedQuery) => void;
  onRemoveInvalid: (id: string) => void;
}

const ProposalCard = ({
  query,
  current,
  onExamine,
  onAccept,
  onRefuse,
}: {
  query: SavedQuery;
  current: boolean;
  onExamine: () => void;
  onAccept: () => void;
  onRefuse: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const titleId = `proposal-title-${query.id}`;
  return (
    <li
      className={
        "flex flex-col gap-2 rounded border p-3 " +
        (current
          ? "border-steel-blue-400 bg-steel-blue-50"
          : "border-gray-200 bg-white")
      }
      aria-current={current ? "true" : undefined}
    >
      <h3
        id={titleId}
        className="text-sm font-semibold text-gray-900 break-words"
      >
        {query.title}
      </h3>
      <p className="text-xs text-gray-500">
        {t("analytics.explorer.proposals.from", {
          client:
            mcpClientName(query.client) ?? t("analytics.explorer.origin.mcp"),
          date: formatStoredDate(query.createdAt, i18n.language),
        })}
      </p>
      {query.description && (
        <p className="line-clamp-4 text-sm text-gray-700 whitespace-pre-line">
          {query.description}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={`${primaryButtonClass} col-span-2 justify-center`}
          aria-describedby={titleId}
          onClick={onExamine}
        >
          <MagnifyingGlassIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.proposals.examine")}
        </button>
        <button
          type="button"
          className={`${secondaryButtonClass} justify-center`}
          aria-describedby={titleId}
          onClick={onAccept}
        >
          <CheckIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.proposals.accept")}
        </button>
        <button
          type="button"
          className={`${secondaryButtonClass} justify-center`}
          aria-describedby={titleId}
          onClick={onRefuse}
        >
          <XMarkIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.proposals.refuse")}
        </button>
      </div>
    </li>
  );
};

export const Proposals = ({
  proposals,
  invalid,
  currentId,
  mcpEnabled,
  onExamine,
  onAccept,
  onRefuse,
  onRemoveInvalid,
}: ProposalsProps) => {
  const { t, i18n } = useTranslation();
  if (proposals === null) {
    return (
      <div
        className="h-24 animate-pulse rounded bg-gray-100"
        aria-busy="true"
      />
    );
  }
  if (proposals.length === 0 && invalid.length === 0) {
    return (
      <p className="p-2 text-sm text-gray-600">
        {t(
          mcpEnabled
            ? "analytics.explorer.proposals.empty"
            : "analytics.explorer.proposals.emptyDisabled"
        )}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {proposals.map((query) => (
        <ProposalCard
          key={query.id}
          query={query}
          current={query.id === currentId}
          onExamine={() => onExamine(query)}
          onAccept={() => onAccept(query)}
          onRefuse={() => onRefuse(query)}
        />
      ))}
      {invalid.map((file) => (
        <li
          key={file.id}
          className="flex flex-col gap-2 rounded border border-yellow-300 bg-yellow-50 p-3"
        >
          <p className="flex items-start gap-2 text-sm text-gray-800">
            <ExclamationTriangleIcon
              className="h-5 w-5 flex-none text-yellow-700"
              aria-hidden
            />
            <span className="break-words">
              {file.title && <strong className="block">{file.title}</strong>}
              {t("analytics.explorer.proposals.invalid", {
                message: t(
                  `analytics.explorer.proposals.invalidReasons.${file.reason}`
                ),
              })}
            </span>
          </p>
          {file.detail && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer">
                {t("analytics.explorer.errors.technicalDetail")}
              </summary>
              <p className="mt-1 font-mono break-all">{file.detail}</p>
            </details>
          )}
          {file.createdAt && (
            <p className="text-xs text-gray-500">
              {t("analytics.explorer.proposals.from", {
                client:
                  mcpClientName(file.client) ??
                  t("analytics.explorer.origin.mcp"),
                date: formatStoredDate(file.createdAt, i18n.language),
              })}
            </p>
          )}
          <button
            type="button"
            className={`${secondaryButtonClass} self-start`}
            onClick={() => onRemoveInvalid(file.id)}
          >
            <TrashIcon className="h-5 w-5" aria-hidden />
            {t("analytics.explorer.proposals.removeInvalid")}
          </button>
        </li>
      ))}
    </ul>
  );
};
