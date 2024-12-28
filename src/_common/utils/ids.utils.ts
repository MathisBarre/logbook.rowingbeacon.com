import { v4 } from "uuid";

export function* generateIds(prefix: string) {
  while (1) {
    yield generateId(prefix);
  }

  return generateId(prefix);
}

export const generateId = (prefix: string) => {
  return `${prefix}-${v4()}`;
};
