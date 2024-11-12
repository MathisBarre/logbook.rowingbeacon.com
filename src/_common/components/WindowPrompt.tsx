import React, { useState, useEffect } from "react";
import Button from "./Button";

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

  const handleOk = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      <div className="absolute inset-0 bg-gray-800 backdrop-blur blur-md opacity-50"></div>
      {/* Modal content */}
      <div className="bg-white rounded-lg shadow-lg z-10 mx-auto p-6 aspect-video w-72">
        <h2 className="text-lg font-medium mb-2">{options.message}</h2>
        <form onSubmit={handleOk}>
          <input
            autoFocus
            type={
              options.message.toLowerCase().includes("mot de passe") ||
              options.message.toLowerCase().includes("password")
                ? "password"
                : "text"
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={handleCancel}
              className="flex-1"
              variant="outlined"
            >
              Annuler
            </Button>
            <Button type="submit" className="flex-1">
              Soumettre
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
