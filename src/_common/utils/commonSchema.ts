import { z } from "zod";

export const dateStringSchema = z.string().refine(
  (value) => {
    const date = new Date(value);
    return !isNaN(date.getTime());
  },
  {
    message: "Date invalide",
  }
);
