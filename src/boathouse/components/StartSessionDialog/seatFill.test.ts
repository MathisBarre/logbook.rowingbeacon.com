import { describe, expect, it } from "vitest";
import { getInitials, getSeatFill, toSeatMember } from "./seatFill";
import { toNewGuestOptionId } from "../../../_common/business/crew.rules";

describe("getSeatFill", () => {
  it("counts the seats left to fill", () => {
    expect(
      getSeatFill({ seats: 4, rowersCount: 1, coxed: false, hasCox: false }),
    ).toEqual({
      remaining: 3,
      overflow: 0,
      complete: false,
      coxMissing: false,
    });
  });

  it("starts with every seat free", () => {
    expect(
      getSeatFill({ seats: 2, rowersCount: 0, coxed: false, hasCox: false })
        .remaining,
    ).toBe(2);
  });

  it("is complete when the seats are all taken", () => {
    const fill = getSeatFill({
      seats: 2,
      rowersCount: 2,
      coxed: false,
      hasCox: false,
    });
    expect(fill.complete).toBe(true);
    expect(fill.remaining).toBe(0);
    expect(fill.overflow).toBe(0);
  });

  it("counts the rowers too many", () => {
    const fill = getSeatFill({
      seats: 2,
      rowersCount: 5,
      coxed: false,
      hasCox: false,
    });
    expect(fill.overflow).toBe(3);
    expect(fill.remaining).toBe(0);
    expect(fill.complete).toBe(false);
  });

  it("flags a missing cox only when the configuration has one", () => {
    const base = { seats: 4, rowersCount: 4 };
    expect(
      getSeatFill({ ...base, coxed: true, hasCox: false }).coxMissing,
    ).toBe(true);
    expect(getSeatFill({ ...base, coxed: true, hasCox: true }).coxMissing).toBe(
      false,
    );
    expect(
      getSeatFill({ ...base, coxed: false, hasCox: false }).coxMissing,
    ).toBe(false);
  });

  it("does not let the cox take a rowing seat", () => {
    const fill = getSeatFill({
      seats: 4,
      rowersCount: 3,
      coxed: true,
      hasCox: true,
    });
    expect(fill.remaining).toBe(1);
  });
});

describe("getInitials", () => {
  it("takes the first and the last word", () => {
    expect(getInitials("Jean-Pierre Martin Dupont")).toBe("JD");
    expect(getInitials("léa martin")).toBe("LM");
  });

  it("copes with a single word or no name", () => {
    expect(getInitials("Cher")).toBe("CH");
    expect(getInitials("  ")).toBe("?");
  });

  it("keeps an emoji whole", () => {
    expect(getInitials("🚣 Léa")).toBe("🚣L");
    expect(getInitials("👩‍🚣 Léa")).toBe("👩‍🚣L");
  });

  it("keeps a decomposed accent and does not double ß", () => {
    expect(getInitials("e\u0301lisa martin")).toBe("ÉM");
    expect(getInitials("ßmith Müller")).toBe("ßM");
  });
});

describe("toSeatMember", () => {
  const rowers = [
    { id: "r1", name: "Jean Dupont" },
    { id: "g1", name: "Paul Invité", status: "guest" },
  ];

  it("uses the rower name, not the select label", () => {
    expect(
      toSeatMember({ id: "r1", name: "Jean Dupont (Senior - Loisir)" }, rowers),
    ).toEqual({ name: "Jean Dupont", initials: "JD", isGuest: false });
  });

  it("tells typed guests and guest records from members", () => {
    expect(
      toSeatMember(
        {
          id: toNewGuestOptionId(" Marie  Curie "),
          name: "Marie Curie (invité)",
        },
        rowers,
      ),
    ).toEqual({ name: "Marie Curie", initials: "MC", isGuest: true });
    expect(toSeatMember({ id: "g1", name: "x" }, rowers).isGuest).toBe(true);
  });
});
