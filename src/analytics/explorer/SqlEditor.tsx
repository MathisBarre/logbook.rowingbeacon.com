import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { basicSetup } from "codemirror";
import { SQLite } from "@codemirror/lang-sql";
import { closeCompletion } from "@codemirror/autocomplete";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import { Diagnostic, forceLinting, linter, lintGutter } from "@codemirror/lint";
import { AnalyticsError } from "../engine/errors";
import { checkSql } from "../engine/sqlGuard";
import type { AnalyticsErrorPayload } from "../types";
import {
  CompletionSchema,
  sqlCompletionSource,
  tokenize,
} from "./sqlCompletion";
import { errorRange } from "./errorRange";
import { InsertKind, planInsert } from "./insertPlacement";

/**
 * The SQL editor of the Explorer (plan 1.3): CodeMirror 6 with the SQLite
 * dialect, line numbers, schema-aware completion (sqlCompletion.ts),
 * Ctrl/Cmd+Enter to run, and the errors underlined where they are:
 *
 * - while typing, the same single-statement check as the engine
 *   (unterminated string or comment, second statement, `?`), and a
 *   warning on a write (DELETE, UPDATE…) before it is even run;
 * - after a run, the engine's error at its offset (or at the denied name,
 *   the missing `:param`…), kept in place while the text is edited around
 *   it and removed when the text under it changes.
 *
 * Highlighting only comes from the SQLite language: its keyword
 * completion (BOOL, BOTH, ABORT…) is left out for sqlCompletion's short
 * list (review 13). Text inserted from the Dictionary flashes for a
 * moment, and on a touch screen the editor never takes the focus by
 * itself (the on-screen keyboard would cover the result, review 58).
 *
 * Lazy-loaded by ExplorerPage: CodeMirror is only in this chunk.
 */

interface EditorError {
  from: number;
  to: number;
  message: string;
  /** The SQL the error belongs to; ignored when the text changed since. */
  sql: string;
}

export interface SqlEditorHandle {
  /** Focuses the editor, except on a touch screen. */
  focus: () => void;
  /**
   * Inserts a name or a filter from the Dictionary (insertPlacement):
   * at the cursor once the user placed it, else where it belongs.
   */
  insertText: (text: string, kind?: InsertKind) => void;
  /** Replaces a range (an error's fix), e.g. LIMT by LIMIT. */
  replaceRange: (from: number, to: number, text: string) => void;
  /** Selects a range, scrolls to it and focuses the editor. */
  select: (from: number, to: number) => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (sql: string) => void;
  onRun: () => void;
  /** Ctrl/Cmd+S. */
  onSave: () => void;
  schema: CompletionSchema;
  error: EditorError | null;
  /** Message of a live-check error (translated by the page). */
  describeError: (payload: AnalyticsErrorPayload) => string;
  /** The read-only notice, shown on a write while typing. */
  writeWarning: string;
  placeholder: string;
  ariaLabel: string;
  /** Large text for touch screens. */
  large?: boolean;
}

interface EngineMark {
  from: number;
  to: number;
  message: string;
}

const setEngineMark = StateEffect.define<EngineMark | null>();

/** The text just inserted, highlighted for a moment. */
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashMark = Decoration.mark({ class: "cm-justInserted" });
const flashField = StateField.define({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setFlash)) {
        next =
          effect.value && effect.value.to > effect.value.from
            ? Decoration.set([
                flashMark.range(effect.value.from, effect.value.to),
              ])
            : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const FLASH_MS = 1200;

/** The engine's error, mapped through edits. */
const engineMarkField = StateField.define<EngineMark | null>({
  create: () => null,
  update(mark, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setEngineMark)) return effect.value;
    }
    if (!mark || !transaction.docChanged) return mark;
    let touched = false;
    transaction.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= mark.to && toA >= mark.from) touched = true;
    });
    if (touched) return null;
    return {
      ...mark,
      from: transaction.changes.mapPos(mark.from, 1),
      to: transaction.changes.mapPos(mark.to, -1),
    };
  },
});

/** Codes worth showing while typing (not "not a SELECT yet"). */
const LIVE_CODES = new Set(["syntax", "multiple_statements", "invalid_param"]);

/** First words of a write, flagged while typing (review 17). */
const WRITE_WORDS = new Set([
  "DELETE",
  "UPDATE",
  "INSERT",
  "REPLACE",
  "DROP",
  "ALTER",
  "CREATE",
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "VACUUM",
  "REINDEX",
]);

const editorTheme = (large: boolean) =>
  EditorView.theme({
    "&": {
      fontSize: large ? "18px" : "14px",
      backgroundColor: "white",
      border: "1px solid rgb(209 213 219)",
      borderRadius: "0.375rem",
    },
    "&.cm-focused": {
      outline: "2px solid #4480c1",
      outlineOffset: "-1px",
    },
    ".cm-scroller": {
      fontFamily: "Roboto Mono, ui-monospace, monospace",
      minHeight: large ? "12rem" : "10rem",
      maxHeight: "28rem",
      lineHeight: "1.55",
    },
    ".cm-content": { padding: "8px 0" },
    ".cm-gutters": {
      backgroundColor: "rgb(249 250 251)",
      borderRight: "1px solid rgb(229 231 235)",
      color: "rgb(107 114 128)",
      borderTopLeftRadius: "0.375rem",
      borderBottomLeftRadius: "0.375rem",
    },
    ".cm-placeholder": { color: "rgb(107 114 128)" },
    ".cm-tooltip-autocomplete ul li": {
      padding: large ? "8px 6px" : "3px 6px",
    },
    ".cm-completionDetail": {
      color: "rgb(107 114 128)",
      fontStyle: "normal",
      marginLeft: "0.75em",
    },
    ".cm-lintRange-error": {
      backgroundColor: "rgb(254 226 226)",
    },
    ".cm-justInserted": {
      backgroundColor: "rgb(254 249 195)",
      transition: "background-color 0.3s",
    },
  });

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(props, ref) {
    const parentRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    /** False until the user taps or clicks in the editor (review 11). */
    const cursorPlaced = useRef(false);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Callbacks and schema read through refs: the editor is created once.
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
      const parent = parentRef.current;
      if (!parent) return;
      const { value, large = false } = latest.current;

      const lint = linter(
        (view): Diagnostic[] => {
          const doc = view.state.doc.toString();
          const diagnostics: Diagnostic[] = [];
          const mark = view.state.field(engineMarkField);
          if (mark && mark.to > mark.from && mark.to <= doc.length) {
            diagnostics.push({
              from: mark.from,
              to: mark.to,
              severity: "error",
              message: mark.message,
            });
          }
          const checked = doc.trim() === "" ? null : checkSql(doc);
          if (
            checked &&
            !checked.ok &&
            checked.error.code === "not_read_only"
          ) {
            const first = tokenize(doc)[0];
            if (first && WRITE_WORDS.has(first.value)) {
              diagnostics.push({
                from: first.from,
                to: first.to,
                severity: "warning",
                message: latest.current.writeWarning,
              });
            }
          }
          if (checked && !checked.ok && LIVE_CODES.has(checked.error.code)) {
            const range = errorRange(new AnalyticsError(checked.error), doc);
            if (range && !(mark && mark.from === range.from)) {
              diagnostics.push({
                from: range.from,
                to: range.to,
                severity: "error",
                message: latest.current.describeError(checked.error),
              });
            }
          }
          return diagnostics;
        },
        {
          delay: 300,
          // A new engine error must show even when no lint run is pending
          // (forceLinting only hurries a scheduled run).
          needsRefresh: (update) =>
            update.transactions.some((transaction) =>
              transaction.effects.some((effect) => effect.is(setEngineMark))
            ),
        }
      );

      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: value,
          extensions: [
            Prec.highest(
              keymap.of([
                {
                  key: "Mod-Enter",
                  preventDefault: true,
                  run: (target) => {
                    // The popup would stay over the result (review 14).
                    closeCompletion(target);
                    latest.current.onRun();
                    return true;
                  },
                },
                {
                  key: "Mod-s",
                  preventDefault: true,
                  run: (target) => {
                    closeCompletion(target);
                    latest.current.onSave();
                    return true;
                  },
                },
              ])
            ),
            basicSetup,
            // Highlighting only: the dialect's keyword completion is noise.
            SQLite.language,
            SQLite.language.data.of({
              autocomplete: sqlCompletionSource(() => latest.current.schema),
            }),
            engineMarkField,
            flashField,
            EditorView.domEventHandlers({
              pointerdown: () => {
                cursorPlaced.current = true;
              },
              keydown: () => {
                cursorPlaced.current = true;
              },
            }),
            lint,
            lintGutter(),
            placeholder(latest.current.placeholder),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              "aria-label": latest.current.ariaLabel,
              spellcheck: "false",
              autocapitalize: "off",
              autocorrect: "off",
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                latest.current.onChange(update.state.doc.toString());
              }
            }),
            editorTheme(large),
          ],
        }),
      });
      viewRef.current = view;
      return () => {
        if (flashTimer.current) clearTimeout(flashTimer.current);
        view.destroy();
        viewRef.current = null;
      };
      // `large` rebuilds the editor (theme); the rest goes through refs.
    }, [props.large]);

    // The store changed the text (open a query, example, history, AI).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== props.value) {
        // A new text: the old cursor means nothing in it (review 11).
        cursorPlaced.current = false;
        view.dispatch({
          changes: { from: 0, to: current.length, insert: props.value },
          selection: { anchor: props.value.length },
        });
      }
    }, [props.value]);

    // The engine answered with an error that has a place in the text.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const { error } = props;
      const doc = view.state.doc.toString();
      const mark =
        error && error.sql === doc && error.to <= doc.length
          ? { from: error.from, to: error.to, message: error.message }
          : null;
      view.dispatch({ effects: setEngineMark.of(mark) });
      forceLinting(view);
    }, [props.error]);

    useImperativeHandle(ref, () => {
      const focusUnlessTouch = (view: EditorView) => {
        if (!latest.current.large) view.focus();
      };
      const flash = (view: EditorView, from: number, to: number) => {
        if (flashTimer.current) clearTimeout(flashTimer.current);
        view.dispatch({ effects: setFlash.of({ from, to }) });
        flashTimer.current = setTimeout(() => {
          viewRef.current?.dispatch({ effects: setFlash.of(null) });
        }, FLASH_MS);
      };
      return {
        focus: () => {
          const view = viewRef.current;
          if (view) focusUnlessTouch(view);
        },
        insertText: (text: string, kind: InsertKind = "column") => {
          const view = viewRef.current;
          if (!view) return;
          const { from, to } = view.state.selection.main;
          const plan = planInsert(
            view.state.doc.toString(),
            cursorPlaced.current ? { from, to } : null,
            text,
            kind
          );
          view.dispatch({
            changes: { from: plan.from, to: plan.to, insert: plan.insert },
            selection: { anchor: plan.mark.to },
            scrollIntoView: true,
            userEvent: "input",
          });
          // The next tap goes after this one.
          cursorPlaced.current = true;
          flash(view, plan.mark.from, plan.mark.to);
          view.dom.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
          focusUnlessTouch(view);
        },
        replaceRange: (from: number, to: number, text: string) => {
          const view = viewRef.current;
          if (!view) return;
          const length = view.state.doc.length;
          if (to > length || from > to) return;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: "input",
          });
          flash(view, from, from + text.length);
        },
        select: (from: number, to: number) => {
          const view = viewRef.current;
          if (!view) return;
          const length = view.state.doc.length;
          const anchor = Math.min(from, length);
          view.dispatch({
            selection: { anchor, head: Math.min(to, length) },
            effects: EditorView.scrollIntoView(anchor, { y: "center" }),
          });
          cursorPlaced.current = true;
          view.dom.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
          focusUnlessTouch(view);
        },
      };
    }, []);

    return <div ref={parentRef} className="min-w-0" />;
  }
);
