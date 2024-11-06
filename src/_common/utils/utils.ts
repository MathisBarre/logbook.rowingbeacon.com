import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isDev = process.env.NODE_ENV === "development";

export const forEnum = <
  EnumValue extends string | number,
  Callbacks extends Record<EnumValue, () => any>
>(
  enumValue: EnumValue,
  callbacks: Callbacks
): ReturnType<Callbacks[typeof enumValue]> => {
  const cb = callbacks[enumValue];
  if (!cb) {
    // ? should never happen, ts should catch it before
    // eslint-disable-next-line regex/invalid
    throw new Error("UNKNOWN_ENUM_VALUE");
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
