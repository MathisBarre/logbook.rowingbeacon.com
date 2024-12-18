import React, { useState, useEffect } from "react";

export type ConfirmOptions = {
  title?: string;
  message: string;
};

type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>;

let confirmFunction: ConfirmFunction | null = null;

export function setConfirmFunction(fn: ConfirmFunction | null) {
  confirmFunction = fn;
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (confirmFunction) {
    return confirmFunction(options);
  } else {
    return Promise.reject(new Error("Confirm function not set"));
  }
}

export const WindowConfirm: React.FC = () => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [promiseHandlers, setPromiseHandlers] = useState<{
    resolve: (value: boolean) => void;
  } | null>(null);

  useEffect(() => {
    setConfirmFunction((options: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        setOptions(options);
        setPromiseHandlers({ resolve });
      });
    });

    return () => {
      setConfirmFunction(null);
    };
  }, []);

  const handleOk = () => {
    if (promiseHandlers) {
      promiseHandlers.resolve(true);
      setOptions(null);
      setPromiseHandlers(null);
    }
  };

  const handleCancel = () => {
    if (promiseHandlers) {
      promiseHandlers.resolve(false);
      setOptions(null);
      setPromiseHandlers(null);
    }
  };

  if (!options) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[999]">
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
            onClick={handleCancel}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded mr-2"
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            className="bg-steel-blue-500 hover:bg-steel-blue-600 text-white font-semibold py-2 px-4 rounded"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
