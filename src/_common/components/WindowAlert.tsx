// alert.ts

export type AlertOptions = {
  title?: string;
  message: string;
};

type AlertFunction = (options: AlertOptions) => Promise<void>;

let alertFunction: AlertFunction | null = null;

export function setAlertFunction(fn: AlertFunction | null) {
  alertFunction = fn;
}

export function alert(options: AlertOptions): Promise<void> {
  if (alertFunction) {
    return alertFunction(options);
  } else {
    return Promise.reject(new Error("Alert function not set"));
  }
}

// AlertDialog.tsx

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const WindowAlert: React.FC = () => {
  const { t } = useTranslation();
  const [options, setOptions] = useState<AlertOptions | null>(null);
  const [promiseHandlers, setPromiseHandlers] = useState<{
    resolve: () => void;
  } | null>(null);

  useEffect(() => {
    setAlertFunction((options: AlertOptions) => {
      return new Promise<void>((resolve) => {
        setOptions(options);
        setPromiseHandlers({ resolve });
      });
    });

    return () => {
      setAlertFunction(null);
    };
  }, []);

  const handleOk = () => {
    if (promiseHandlers) {
      promiseHandlers.resolve();
      setOptions(null);
      setPromiseHandlers(null);
    }
  };

  if (!options) return null;

  // Modal content
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999]">
      {/* Background overlay */}
      <div className="absolute inset-0 bg-gray-800 opacity-50"></div>
      {/* Modal content */}
      <div className="bg-white rounded-lg shadow-lg z-10 max-w-sm mx-auto p-6">
        {options.title && (
          <h2 className="text-xl font-semibold mb-4">{options.title}</h2>
        )}
        <p className="mb-6">{options.message}</p>
        <div className="flex justify-end">
          <button
            onClick={handleOk}
            className="bg-steel-blue-500 hover:bg-steel-blue-600 text-white font-semibold py-2 px-4 rounded"
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
};
