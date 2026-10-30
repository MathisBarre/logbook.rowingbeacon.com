import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { useAdminLockStore } from "../access/useAnalyticsAdmin";
import { onAnalyticsLocalMemoryCleared } from "../store/localMemory";
import { AiHistoryEntry, readAiHistory, rememberAiAnswer } from "./aiHistory";
import {
  AiAssistantDeps,
  AiPanelDraft,
  createAiAssistantController,
} from "./useAiAssistant";

/**
 * The assistant outlives its panel (review #8): the hub mounts one panel
 * per tab, so a look at the dashboard while the AI works used to abort the
 * paid request and lose the question. The controller, the texts being
 * typed and an answer that arrived meanwhile live here; the request is
 * stopped only by "Arrêter", "Nouvelle question", or when the hub locks
 * (the lock button, the idle lock, leaving Statistiques, which locks).
 */

/** What the panel provides; read at call time (the last panel mounted). */
export type AiPanelDeps = Omit<AiAssistantDeps, "onAnswer" | "onAnswered">;

interface AiAssistantStore {
  /** The question box. */
  question: string;
  /** The refine field under an answer. */
  followUp: string;
  /** An answer that arrived while no panel was mounted. */
  pendingDraft: AiPanelDraft | null;
  /** Answers remembered on this computer, newest first. */
  history: AiHistoryEntry[];
  /** Step 3 of "Utiliser votre IA habituelle" is shown (review #22). */
  pasteOpen: boolean;
  /**
   * The copy-paste path chosen after an API error ("Copier la demande
   * pour votre IA habituelle"), although a key is set (review #29).
   */
  usualAi: boolean;
  setQuestion: (question: string) => void;
  setFollowUp: (followUp: string) => void;
  openPaste: () => void;
  /** The pending answer, once (null afterwards). */
  takePendingDraft: () => AiPanelDraft | null;
}

export const useAiAssistantStore = create<AiAssistantStore>()((set, get) => ({
  question: "",
  followUp: "",
  pendingDraft: null,
  history: readAiHistory(),
  pasteOpen: false,
  usualAi: false,
  setQuestion(question) {
    set({ question });
  },
  setFollowUp(followUp) {
    set({ followUp });
  },
  openPaste() {
    set({ pasteOpen: true });
  },
  takePendingDraft() {
    const draft = get().pendingDraft;
    if (draft) set({ pendingDraft: null });
    return draft;
  },
}));

let panelDeps: AiPanelDeps | null = null;
let answerHandler: ((draft: AiPanelDraft) => void) | null = null;

const depsOf = () => {
  if (!panelDeps) throw new Error("The AI panel is not mounted");
  return panelDeps;
};

let controller: ReturnType<typeof createAiAssistantController> | null = null;

/** The one controller of the app, created on first use. */
export const getAiController = () => {
  controller ??= createAiAssistantController({
    buildSystem: (signal) => depsOf().buildSystem(signal),
    ask: (request) => depsOf().ask(request),
    run: (sql, values, signal) => depsOf().run(sql, values, signal),
    getTarget: () => depsOf().getTarget(),
    getParamContext: () => depsOf().getParamContext(),
    onAnswer: (draft) => {
      if (answerHandler) answerHandler(draft);
      else useAiAssistantStore.setState({ pendingDraft: draft });
    },
    onAnswered: (answered) => {
      const history = rememberAiAnswer({
        ...answered,
        at: new Date().toISOString(),
      });
      useAiAssistantStore.setState({ history });
    },
  });
  return controller;
};

/** The panel provides its dependencies (each render: the latest win). */
export const bindAiPanel = (deps: AiPanelDeps) => {
  panelDeps = deps;
};

/**
 * The mounted panel receives the answers; the returned cleanup leaves
 * them pending again (the request goes on).
 */
export const attachAiPanel = (onAnswer: (draft: AiPanelDraft) => void) => {
  answerHandler = onAnswer;
  return () => {
    if (answerHandler === onAnswer) answerHandler = null;
  };
};

/** The controller's state, for React. */
export const useAiController = () => {
  const ctrl = getAiController();
  const state = useSyncExternalStore(
    ctrl.subscribe,
    ctrl.getState,
    ctrl.getState
  );
  return { state, controller: ctrl };
};

/** Stops the request and forgets the question (lock, new club). */
export const resetAiAssistant = () => {
  controller?.reset();
  useAiAssistantStore.setState({
    question: "",
    followUp: "",
    pendingDraft: null,
    pasteOpen: false,
    usualAi: false,
  });
};

// Locking the hub (the button, the idle lock, leaving Statistiques) stops
// the request: the next member at the boathouse finds nothing of it.
useAdminLockStore.subscribe((state, previous) => {
  if (previous.isUnlocked && !state.isUnlocked) resetAiAssistant();
});

// "Supprimer toutes les données": the remembered answers go too.
onAnalyticsLocalMemoryCleared(() => {
  resetAiAssistant();
  useAiAssistantStore.setState({ history: [] });
});
