import { useEffect, useRef, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "../../_common/store/sessions.store";
import { useBoathouseSettingsStore } from "../../_common/store/boathouseSettings.store";

const BANNER_DURATION_SECONDS = 10;
/** A held Enter or a double tap on "Stop" must not close it at once. */
const IGNORE_INPUT_AFTER_OPEN_MS = 500;
const FOCUS_RETRY_MS = 100;

/**
 * Reminder shown when the last ongoing outing ends. Not shown at startup, nor
 * when a failed start is rolled back: only finishing an outing triggers it.
 */
export const AllBoatsBackBanner = () => {
  const { t } = useTranslation();
  const enabled = useBoathouseSettingsStore(
    (state) => state.allBoatsBackBanner
  );
  const ongoingCount = useSessionsStore(
    (state) => state.session.filter((session) => !session.endDateTime).length
  );
  const lastEndedAt = useSessionsStore((state) => state.lastEndedAt);
  // An outing finished before this screen was mounted does not count
  const seenEndedAt = useRef(lastEndedAt);
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    // A new outing started: the reminder is outdated and must not come back
    if (ongoingCount > 0) {
      setShownAt(null);
    }
    if (lastEndedAt === seenEndedAt.current) {
      return;
    }
    seenEndedAt.current = lastEndedAt;
    if (lastEndedAt !== null && ongoingCount === 0 && enabled) {
      setShownAt(lastEndedAt);
    }
  }, [lastEndedAt, ongoingCount, enabled]);

  const isVisible = shownAt !== null && ongoingCount === 0 && enabled;

  if (!isVisible) {
    return null;
  }

  return (
    <BannerContent
      key={shownAt}
      message={t("boathouse.allBoatsBack")}
      onClose={() => setShownAt(null)}
    />
  );
};

const BannerContent = ({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(BANNER_DURATION_SECONDS);
  const [openedAt] = useState(() => Date.now());
  const isTooEarly = () => Date.now() - openedAt < IGNORE_INPUT_AFTER_OPEN_MS;
  const dialogRef = useRef<HTMLDivElement>(null);

  // The end-of-outing dialog is still closing when this opens: while it is
  // there it keeps the focus and hides the rest of the page from screen
  // readers. Take the focus once it is gone, so the reminder is announced.
  useEffect(() => {
    const takeFocus = () => {
      if (document.querySelector('[role="dialog"]')) {
        return false;
      }
      dialogRef.current?.focus();
      return true;
    };
    if (takeFocus()) {
      return;
    }
    const interval = window.setInterval(() => {
      if (takeFocus()) {
        window.clearInterval(interval);
      }
    }, FOCUS_RETRY_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (["Escape", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (!event.repeat && !isTooEarly()) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRemaining((seconds) => seconds - 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (remaining <= 0) {
      onClose();
    }
  }, [remaining, onClose]);

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="all-boats-back-message"
      tabIndex={-1}
      className="fixed inset-0 z-[9000] pointer-events-auto flex items-center justify-center bg-black/60 cursor-pointer outline-none"
      onClick={() => {
        if (!isTooEarly()) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl border-t-8 border-green-600 max-w-3xl mx-6 px-12 py-10 flex flex-col items-center gap-6 text-center">
        <KeyRoundIcon className="w-24 h-24 text-green-600" strokeWidth={1.5} />
        <p
          id="all-boats-back-message"
          className="text-4xl font-bold text-gray-900"
        >
          {message}
        </p>
        <div className="w-full flex flex-col items-center gap-2">
          <div className="w-full h-2 bg-gray-200 rounded overflow-hidden">
            <div
              className="h-full bg-green-600 transition-[width] duration-1000 ease-linear"
              style={{
                width: `${(Math.max(remaining, 0) / BANNER_DURATION_SECONDS) * 100}%`,
              }}
            />
          </div>
          <p className="text-gray-500" aria-live="off">
            {t("boathouse.allBoatsBackClosing", { seconds: remaining })}
          </p>
        </div>
      </div>
    </div>
  );
};
