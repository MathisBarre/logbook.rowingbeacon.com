/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isDev = process.env.NODE_ENV === "development";

export const forEnum = <
  EnumValue extends string | number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Callbacks extends Record<EnumValue, () => any>
>(
  enumValue: EnumValue,
  callbacks: Callbacks,
  fallback?: () => ReturnType<Callbacks[keyof Callbacks]>
): ReturnType<Callbacks[typeof enumValue]> => {
  const cb = callbacks[enumValue];
  if (!cb) {
    console.warn(`Unknown enum value: ${enumValue}`);
    if (fallback) {
      return fallback();
    }
    return undefined as ReturnType<Callbacks[typeof enumValue]>;
  }
  return cb();
};

/**
 * Used the remove empty lines and useless spaces
 * With this taggedTemplate, you will be able to indent properly your string in your text while keeping the log clean
 */
export const logStr = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): string => {
  const combinedString = strings.reduce(
    (acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ""),
    ""
  );

  const cleanedLines = combinedString
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line !== "");

  return cleanedLines.join("\n");
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
