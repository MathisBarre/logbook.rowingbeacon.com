import { describe, expect, test } from "vitest";
import {
  efaDateToIso,
  efaDistanceToMetres,
  efaList,
  efaTimeToHhMm,
  isoToEfaDate,
  metresToEfaDistance,
  toEfaList,
} from "./efa2Values";
import { splitFreeName } from "./planEfa2Import";

describe("efa2 values", () => {
  test("dates", () => {
    expect(efaDateToIso("08.03.2025")).toBe("2025-03-08");
    expect(efaDateToIso("3/8/2025")).toBe("2025-03-08");
    expect(efaDateToIso("03/2025")).toBe("2025-03-01");
    expect(efaDateToIso("2025")).toBe("2025-01-01");
    expect(efaDateToIso("")).toBeNull();
    expect(isoToEfaDate("2025-03-08")).toBe("08.03.2025");
    expect(isoToEfaDate("2025-03-08T14:45")).toBe("08.03.2025");
  });

  test("times", () => {
    expect(efaTimeToHhMm("14:45:00")).toBe("14:45");
    expect(efaTimeToHhMm("7:05")).toBe("07:05");
  });

  test("distances", () => {
    expect(efaDistanceToMetres("12.5 km")).toBe(12500);
    expect(efaDistanceToMetres("6000 m")).toBe(6000);
    expect(efaDistanceToMetres("5")).toBe(5000);
    expect(efaDistanceToMetres("1 mi")).toBe(1609);
    expect(efaDistanceToMetres("abc")).toBeNull();
    expect(metresToEfaDistance(12500)).toBe("12.5 km");
    expect(metresToEfaDistance(null)).toBeUndefined();
  });

  test("lists", () => {
    expect(efaList("a;~;b")).toEqual(["a", "", "b"]);
    expect(efaList(undefined)).toEqual([]);
    expect(toEfaList(["a", null, "b;c"])).toBe("a;~;b,c");
  });

  test("free names", () => {
    expect(splitFreeName("Mustermann, Max")).toEqual({
      firstName: "Max",
      lastName: "Mustermann",
    });
    expect(splitFreeName("Max,")).toEqual({ firstName: "Max", lastName: "" });
  });
});
