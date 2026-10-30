import { describe, expect, it } from "vitest";
import { buildNameIndex, findNames, foldText, replaceNames } from "./nameCheck";

const people = [
  { firstName: "Anouk", lastName: "Abgrall" },
  { firstName: "Élodie", lastName: "Le Goff" },
  { firstName: "Jean-Marc", lastName: "Mistral" },
  { firstName: "Al", lastName: "Bo" },
];

describe("rowers' names in a question", () => {
  const index = buildNameIndex(people, ["Mistral", "Loire", "mardi"]);

  it("folds accents and case", () => {
    expect(foldText("Élodie ÇA")).toBe("elodie ca");
  });

  it("finds whole names, accent- and case-insensitive", () => {
    expect(findNames("Combien de sorties pour anouk abgrall ?", index)).toEqual(
      ["anouk", "abgrall"]
    );
    expect(findNames("les sorties d'Elodie", index)).toEqual(["d'Elodie"]);
    expect(findNames("Les sorties de GOFF", index)).toEqual(["GOFF"]);
    expect(findNames("Jean-Marc", index)).toEqual(["Jean-Marc"]);
  });

  it("ignores short words, parts of words, boats and routes", () => {
    // "Mistral" is a boat: the AI may know it.
    expect(findNames("Sorties du Mistral le mardi", index)).toEqual([]);
    // "Bo" and "Al" are too short to tell; "Anoukette" is another word.
    expect(findNames("Bo et Al, Anoukette", index)).toEqual([]);
    expect(findNames("Kilomètres par rameur", index)).toEqual([]);
  });

  it("replaces a first and last name by one placeholder", () => {
    const text = "Sorties d'Anouk Abgrall et de Goff en mai";
    expect(replaceNames(text, findNames(text, index), "un rameur")).toBe(
      "Sorties d'un rameur et de un rameur en mai"
    );
    expect(
      replaceNames(
        "Combien pour Anouk Abgrall ?",
        ["Anouk", "Abgrall"],
        "un rameur"
      )
    ).toBe("Combien pour un rameur ?");
    expect(replaceNames("rien", [], "x")).toBe("rien");
  });

  it("finds nothing without rowers", () => {
    expect(findNames("Anouk", buildNameIndex([]))).toEqual([]);
  });
});
