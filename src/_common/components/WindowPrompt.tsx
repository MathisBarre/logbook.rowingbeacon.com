import React, { useState, useEffect } from "react";

export type PromptOptions = {
  title?: string;
  message: string;
  defaultValue?: string;
};

type PromptFunction = (options: PromptOptions) => Promise<string | null>;

let promptFunction: PromptFunction | null = null;

export function setPromptFunction(fn: PromptFunction | null) {
  promptFunction = fn;
}

export function prompt(options: PromptOptions): Promise<string | null> {
  if (promptFunction) {
    return promptFunction(options);
  } else {
    return Promise.reject("Prompt function not set");
  }
}

export const WindowPrompt: React.FC = () => {
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [inputValue, setInputValue] = useState<string>("");
  const [promiseHandlers, setPromiseHandlers] = useState<{
    resolve: (value: string | null) => void;
  } | null>(null);

  useEffect(() => {
    setPromptFunction((options: PromptOptions) => {
      return new Promise<string | null>((resolve) => {
        setOptions(options);
        setInputValue(options.defaultValue || "");
        setPromiseHandlers({ resolve });
      });
    });

    return () => {
      setPromptFunction(null);
    };
  }, []);

  const handleOk = () => {
    if (promiseHandlers) {
      promiseHandlers.resolve(inputValue);
      setOptions(null);
      setPromiseHandlers(null);
    }
  };

  const handleCancel = () => {
    if (promiseHandlers) {
      promiseHandlers.resolve(null);
      setOptions(null);
      setPromiseHandlers(null);
    }
  };

  if (!options) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      role="dialog"
    >
      {/* Background overlay */}
      <div className="absolute inset-0 bg-gray-800 opacity-50"></div>
      {/* Modal content */}
      <div className="bg-white rounded-lg shadow-lg z-10 max-w-sm mx-auto p-6">
        {options.title && (
          <h2 className="text-xl font-semibold mb-4">{options.title}</h2>
        )}
        <p className="mb-4">{options.message}</p>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 mb-6"
        />
        <div className="flex justify-end">
          <button
            onClick={handleCancel}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded mr-2"
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
