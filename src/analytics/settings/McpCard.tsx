import {
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ANALYTICS_COMMANDS } from "../engine/ipc";
import type { McpInfo, McpLastCall } from "../engine/ipc";
import { AiError, mcpInfo, toAiError } from "../ai/aiClient";
import type { PrivacyMode } from "../types";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  claudeDesktopConfigPath,
  codexConfigPath,
  codexConfigToml,
  cursorConfig,
  cursorConfigPath,
  isTemporaryMacosPath,
  stdioCommand,
  vscodeConfig,
} from "./mcpSnippets";
import {
  CopyBlock,
  Disclosure,
  Notice,
  RadioCard,
  SettingsCard,
  Switch,
  TechnicalDetails,
  buttonClass,
  focusRing,
} from "./SettingsControls";

const PRIVACY_MODES: PrivacyMode[] = ["pseudonymised", "nominative"];

type InfoState =
  | { kind: "loading" }
  | { kind: "ready"; info: McpInfo }
  | { kind: "error"; error: AiError };

export const MCP_CLIENTS = [
  "claudeDesktop",
  "claudeCode",
  "codex",
  "cursor",
  "vscode",
  "other",
] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

/** `analytics_mcp_last_call`: the last question an AI app sent here. */
export const mcpLastCall = async (): Promise<McpLastCall | null> => {
  if (!isTauri()) {
    throw new AiError("desktop_only", "MCP needs the installed application");
  }
  try {
    return await invoke<McpLastCall | null>(ANALYTICS_COMMANDS.mcpLastCall);
  } catch (error) {
    throw toAiError(error);
  }
};

/** The usual names of the MCP clients (their `clientInfo.name`). */
const CLIENT_NAMES: [RegExp, string][] = [
  [/^claude-ai$|claude.?desktop/i, "Claude Desktop"],
  [/^claude-code$|claude.?code/i, "Claude Code"],
  [/codex|chatgpt|openai/i, "ChatGPT / Codex"],
  [/cursor/i, "Cursor"],
  [/visual studio code|vscode|copilot/i, "VS Code"],
];

export const clientDisplayName = (client: string): string =>
  CLIENT_NAMES.find(([pattern]) => pattern.test(client))?.[1] ?? client;

/** "Dernière question reçue : Claude Desktop, le 19 juin à 20:41." */
export const lastCallText = (
  call: McpLastCall,
  t: (key: string, values?: Record<string, string>) => string,
  locale: string
) => {
  const [date, time] = call.at.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const when = new Date(year, month - 1, day, hours, minutes);
  return t("analytics.settings.mcp.lastCall", {
    client: call.client
      ? clientDisplayName(call.client)
      : t("analytics.settings.mcp.unknownClient"),
    date: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: year === new Date().getFullYear() ? undefined : "numeric",
    }).format(when),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(when),
  });
};

/**
 * One client at a time: a segmented choice (radio group, arrow keys move
 * between clients), preselected with the platform's usual client.
 */
const ClientPicker = ({
  value,
  onChange,
}: {
  value: McpClient;
  onChange: (client: McpClient) => void;
}) => {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<McpClient, HTMLButtonElement | null>>>({});
  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      MCP_CLIENTS[(index + step + MCP_CLIENTS.length) % MCP_CLIENTS.length];
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("analytics.settings.mcp.clientsTitle")}
      className="flex flex-wrap gap-2"
    >
      {MCP_CLIENTS.map((client, index) => {
        const checked = client === value;
        return (
          <button
            key={client}
            ref={(element) => {
              refs.current[client] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(client)}
            onKeyDown={(event) => move(event, index)}
            className={
              "min-h-11 px-4 rounded border text-sm font-medium " +
              focusRing +
              " " +
              (checked
                ? "bg-steel-blue-700 border-steel-blue-700 text-white"
                : "bg-white border-gray-300 text-gray-800 hover:bg-gray-50")
            }
          >
            {t(`analytics.settings.mcp.clients.${client}`)}
          </button>
        );
      })}
    </div>
  );
};

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="list-decimal pl-6 flex flex-col gap-3 text-sm text-gray-800 marker:font-medium marker:text-steel-blue-800">
    {children}
  </ol>
);

const Step = ({ children }: { children: ReactNode }) => (
  <li className="pl-1 break-words">
    <div className="flex flex-col gap-2">{children}</div>
  </li>
);

/** The numbered steps of one client. */
const ClientSteps = ({
  client,
  info,
}: {
  client: McpClient;
  info: McpInfo;
}) => {
  const { t } = useTranslation();
  const title = t(`analytics.settings.mcp.clients.${client}`);
  const ask = (app: string) => (
    <Step>{t("analytics.settings.mcp.steps.ask", { app })}</Step>
  );
  const copy = (text: string, command = false) => (
    <Step>
      <span>
        {t(
          command
            ? "analytics.settings.mcp.steps.copyCommand"
            : "analytics.settings.mcp.steps.copy"
        )}
      </span>
      <CopyBlock text={text} label={title} />
    </Step>
  );
  switch (client) {
    case "claudeDesktop": {
      const path = claudeDesktopConfigPath(info);
      if (path === null) {
        return (
          <p className="text-sm text-gray-700">
            {t("analytics.settings.mcp.linux")}
          </p>
        );
      }
      return (
        <Steps>
          {copy(claudeDesktopConfig(info))}
          <Step>
            {t("analytics.settings.mcp.steps.claudeDesktopOpen", { path })}
          </Step>
          <Step>{t("analytics.settings.mcp.steps.pasteMcpServers")}</Step>
          {ask(title)}
        </Steps>
      );
    }
    case "claudeCode":
      return (
        <Steps>
          {copy(claudeCodeCommand(info), true)}
          <Step>{t("analytics.settings.mcp.steps.claudeCodeRun")}</Step>
          <Step>{t("analytics.settings.mcp.steps.claudeCodeAsk")}</Step>
        </Steps>
      );
    case "codex":
      return (
        <Steps>
          {copy(codexConfigToml(info))}
          <Step>
            {t("analytics.settings.mcp.steps.codexOpen", {
              path: codexConfigPath(info.platform),
            })}
          </Step>
          <Step>{t("analytics.settings.mcp.steps.codexPaste")}</Step>
          {ask(title)}
        </Steps>
      );
    case "cursor":
      return (
        <Steps>
          {copy(cursorConfig(info))}
          <Step>
            {t("analytics.settings.mcp.steps.cursorOpen", {
              path: cursorConfigPath(info.platform),
            })}
          </Step>
          <Step>{t("analytics.settings.mcp.steps.pasteMcpServers")}</Step>
          {ask(title)}
        </Steps>
      );
    case "vscode":
      return (
        <Steps>
          {copy(vscodeConfig(info))}
          <Step>{t("analytics.settings.mcp.steps.vscodeOpen")}</Step>
          <Step>{t("analytics.settings.mcp.steps.vscodePaste")}</Step>
          <Step>{t("analytics.settings.mcp.steps.vscodeAsk")}</Step>
        </Steps>
      );
    case "other":
      return (
        <Steps>
          <Step>
            <span>{t("analytics.settings.mcp.otherClients")}</span>
            <CopyBlock text={stdioCommand(info)} label={title} />
          </Step>
          {ask(t("analytics.settings.mcp.steps.yourApp"))}
        </Steps>
      );
  }
};

/**
 * The paste-ready configuration for this computer: pick the app, then
 * follow its numbered steps (formats checked in `mcpSnippets`).
 */
export const McpSetup = ({
  info,
  initialClient,
  titled = true,
}: {
  info: McpInfo;
  /** The client shown first; the platform's usual one by default. */
  initialClient?: McpClient;
  /** False inside a Disclosure that already shows the title. */
  titled?: boolean;
}) => {
  const { t } = useTranslation();
  const usual: McpClient =
    info.platform === "linux" ? "claudeCode" : "claudeDesktop";
  const [client, setClient] = useState<McpClient>(initialClient ?? usual);
  return (
    <div className="flex flex-col gap-3">
      {info.isAppImage && (
        <Notice tone="warning">{t("analytics.settings.mcp.appImage")}</Notice>
      )}
      {isTemporaryMacosPath(info) && (
        <Notice tone="warning">
          {t("analytics.settings.mcp.macosTemporary")}
        </Notice>
      )}
      <div className="flex flex-col gap-1">
        {titled && (
          <h3 className="font-medium text-gray-900">
            {t("analytics.settings.mcp.clientsTitle")}
          </h3>
        )}
        <p className="text-sm text-gray-600">
          {t("analytics.settings.mcp.clientsHelp")}
        </p>
      </div>
      <ClientPicker value={client} onChange={setClient} />
      <p className="text-sm text-gray-600">
        {t("analytics.settings.mcp.clientsNote")}
      </p>
      <div className="rounded border border-gray-200 bg-gray-50 p-3">
        <ClientSteps client={client} info={info} />
      </div>
    </div>
  );
};

type LastCallState =
  | { kind: "loading" }
  | { kind: "ready"; call: McpLastCall | null }
  | { kind: "error" };

/** Whether an AI app already asked something, refreshed on window focus. */
const useLastCall = (
  enabled: boolean,
  load: () => Promise<McpLastCall | null>
) => {
  const [state, setState] = useState<LastCallState>({ kind: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () =>
      load().then(
        (call) => {
          if (alive) setState({ kind: "ready", call });
        },
        () => {
          if (alive) setState({ kind: "error" });
        }
      );
    const onFocus = () => void refresh();
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, load]);
  return state;
};

/**
 * Card 4: the AI apps of this computer (Claude Desktop, ChatGPT / Codex,
 * Cursor, VS Code…) through MCP (plan 1.3, 2.12). What it is stays
 * visible; the privacy choice and the setup appear once it is on.
 */
export const McpCard = ({
  loadInfo = mcpInfo,
  loadLastCall = mcpLastCall,
}: {
  loadInfo?: () => Promise<McpInfo>;
  loadLastCall?: () => Promise<McpLastCall | null>;
}) => {
  const { t, i18n } = useTranslation();
  const enabled = useAnalyticsSettingsStore((s) => s.mcpEnabled);
  const setEnabled = useAnalyticsSettingsStore((s) => s.setMcpEnabled);
  const privacy = useAnalyticsSettingsStore((s) => s.mcpPrivacy);
  const setPrivacy = useAnalyticsSettingsStore((s) => s.setMcpPrivacy);
  const [info, setInfo] = useState<InfoState>({ kind: "loading" });
  const lastCall = useLastCall(enabled, loadLastCall);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(() => {
    setInfo({ kind: "loading" });
    loadInfo().then(
      (value) => {
        if (alive.current) setInfo({ kind: "ready", info: value });
      },
      (error: unknown) => {
        if (alive.current) setInfo({ kind: "error", error: toAiError(error) });
      }
    );
  }, [loadInfo]);
  useEffect(load, [load]);

  const connection =
    lastCall.kind !== "ready"
      ? null
      : lastCall.call
        ? lastCallText(lastCall.call, t, i18n.language)
        : t("analytics.settings.mcp.lastCallNone");

  return (
    <SettingsCard
      id="analytics-mcp"
      title={t("analytics.settings.mcp.title")}
      description={t("analytics.settings.mcp.help")}
    >
      <Switch
        id="analytics-mcp-enabled"
        checked={enabled}
        onChange={setEnabled}
        label={t("analytics.settings.mcp.enabled")}
        description={
          enabled
            ? connection && (
                <span
                  className={
                    lastCall.kind === "ready" && lastCall.call
                      ? "text-success-800"
                      : undefined
                  }
                >
                  {connection}
                </span>
              )
            : t("analytics.settings.mcp.disabledNote")
        }
      />

      {enabled && (
        <>
          <Notice tone="info">{t("analytics.settings.mcp.whatIsSent")}</Notice>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium text-gray-900 mb-1">
              {t("analytics.settings.mcp.privacyLabel")}
            </legend>
            {PRIVACY_MODES.map((mode) => (
              <RadioCard
                key={mode}
                name="analytics-mcp-privacy"
                value={mode}
                checked={privacy === mode}
                onChange={() => setPrivacy(mode)}
                title={t(`analytics.settings.mcp.privacyModes.${mode}.title`)}
                description={t(
                  `analytics.settings.mcp.privacyModes.${mode}.description`
                )}
              />
            ))}
          </fieldset>
          {privacy === "nominative" && (
            <Notice tone="warning">
              {t("analytics.settings.mcp.nominativeWarning")}
            </Notice>
          )}

          {info.kind === "ready" && lastCall.kind !== "loading" ? (
            // Folded once an app has connected: the steps are done.
            <Disclosure
              summary={t("analytics.settings.mcp.clientsTitle")}
              defaultOpen={!(lastCall.kind === "ready" && lastCall.call)}
            >
              <McpSetup info={info.info} titled={false} />
            </Disclosure>
          ) : info.kind === "error" ? (
            <div className="flex flex-col gap-2 items-start">
              <Notice tone="error">
                {info.error.code === "desktop_only"
                  ? t("analytics.common.states.desktopOnly")
                  : t("analytics.settings.mcp.infoError")}
              </Notice>
              {info.error.code !== "desktop_only" && (
                <>
                  <button
                    type="button"
                    className={buttonClass("outlined")}
                    onClick={load}
                  >
                    {t("analytics.settings.retry")}
                  </button>
                  <TechnicalDetails message={info.error.message} />
                </>
              )}
            </div>
          ) : (
            <p role="status" className="text-sm text-gray-600">
              {t("analytics.settings.mcp.loading")}
            </p>
          )}
        </>
      )}
    </SettingsCard>
  );
};
