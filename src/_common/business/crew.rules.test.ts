import { describe, expect, it } from "vitest";
import { AgeCategoryEnum } from "./ageCategory.rules";
import {
  getDefaultCaptainId,
  getNewGuestName,
  hasDuplicateCrewMember,
  isSamePersonName,
  personNameIncludes,
  isAdult,
  toNewGuestOptionId,
} from "./crew.rules";

const today = new Date("2026-10-18T10:00:00");

describe("crew rules", () => {
  it("round-trips a typed guest name through an option id", () => {
    expect(getNewGuestName(toNewGuestOptionId(" Ana Silva "))).toBe(
      "Ana Silva"
    );
    expect(getNewGuestName("3f1c")).toBeNull();
  });

  it("uses the birth date before the age category", () => {
    expect(isAdult({ birthDate: "2008-10-18" }, today)).toBe(true);
    expect(isAdult({ birthDate: "2008-10-19" }, today)).toBe(false);
    expect(
      isAdult({ birthDate: "1990-01-01", category: AgeCategoryEnum.J16 }, today)
    ).toBe(true);
    expect(isAdult({ category: AgeCategoryEnum.J16 }, today)).toBe(false);
    expect(isAdult({}, today)).toBe(true);
  });

  it("suggests the cox, otherwise the first adult rower", () => {
    expect(
      getDefaultCaptainId(
        [
          { id: "a", role: "rower" },
          { id: "c", role: "cox", category: AgeCategoryEnum.J14 },
        ],
        today
      )
    ).toBe("c");
    expect(
      getDefaultCaptainId(
        [
          { id: "a", role: "rower", category: AgeCategoryEnum.J14 },
          { id: "b", role: "rower", category: AgeCategoryEnum.SENIOR },
        ],
        today
      )
    ).toBe("b");
    expect(
      getDefaultCaptainId(
        [{ id: "a", role: "rower", category: AgeCategoryEnum.J14 }],
        today
      )
    ).toBeNull();
  });

  it("does not suggest a guest as captain", () => {
    expect(
      getDefaultCaptainId(
        [
          { id: toNewGuestOptionId("Paul"), role: "rower" },
          { id: "g", role: "rower", status: "guest" },
          { id: "b", role: "rower" },
        ],
        today
      )
    ).toBe("b");
    expect(
      getDefaultCaptainId(
        [
          { id: toNewGuestOptionId("Paul"), role: "cox" },
          { id: "b", role: "rower" },
        ],
        today
      )
    ).toBe("b");
  });
});

describe("crew members", () => {
  it("compares typed names without accents, case or extra spaces", () => {
    expect(isSamePersonName("Léa  Martin ", "lea martin")).toBe(true);
    expect(isSamePersonName("Léa Martin", "Léo Martin")).toBe(false);
  });

  it("spots someone picked twice", () => {
    expect(hasDuplicateCrewMember(["a", "b"])).toBe(false);
    expect(hasDuplicateCrewMember(["a", "a"])).toBe(true);
    expect(
      hasDuplicateCrewMember([
        toNewGuestOptionId("Paul"),
        toNewGuestOptionId("PAUL "),
      ])
    ).toBe(true);
  });
});

describe("personNameIncludes", () => {
  it("finds a name typed with extra spaces, accents or case", () => {
    expect(personNameIncludes("Léa Martin", "Léa  Martin")).toBe(true);
    expect(personNameIncludes("Léa Martin", " lea  mar")).toBe(true);
    expect(personNameIncludes("Léa Martin", "Léo")).toBe(false);
  });
});
