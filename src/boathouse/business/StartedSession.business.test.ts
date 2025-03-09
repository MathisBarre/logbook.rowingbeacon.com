import { describe, expect, it } from "vitest";
import {
  getAlreadyOnStartedSessionRowersId,
  StartedSession,
} from "./StartedSession.business";
import { Rower } from "../../_common/business/rower.rules";

describe("getRowersAlreadyOnStartedSession", () => {
  it("should return empty array when no rowers are on session", () => {
    const rowers: string[] = ["rower1", "rower2"];
    const startedSessions: StartedSession[] = [];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual([]);
  });

  it("should return rowers that are already on session", () => {
    const rowers: string[] = ["rower1", "rower2", "rower3"];
    const startedSessions = [
      {
        id: "session1",
        rowers: [
          { id: "rower1", name: "Rower 1" } as Rower,
          { id: "rower2", name: "Rower 2" } as Rower,
        ],
      },
    ];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual(["rower1", "rower2"]);
  });

  it("should handle multiple sessions", () => {
    const rowers: string[] = ["rower1", "rower2", "rower3"];
    const startedSessions = [
      {
        id: "session1",
        rowers: [{ id: "rower1", name: "Rower 1" } as Rower],
      },
      {
        id: "session2",
        rowers: [{ id: "rower3", name: "Rower 3" } as Rower],
      },
    ];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual(["rower1", "rower3"]);
  });
});
