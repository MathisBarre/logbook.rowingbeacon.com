import { beforeEach, describe, expect, it, vi } from "vitest";
import { StopSession } from "./StopSession.usecase";
import { asError, asOk } from "../../../_common/utils/error";
import { OngoingOuting } from "../../../_common/database/repositories/club.types";

describe("StopSession", () => {
  const SESSION_ID = "DUMMY:session";
  const BOAT_ID = "DUMMY:boat";
  const END = "2025-01-01T10:30";
  const END_ISO = new Date(END).toISOString();

  const getOuting = (): OngoingOuting => ({
    id: SESSION_ID,
    rowers: [],
    route: null,
    boat: { id: BOAT_ID, name: "DUMMY:boat" },
    captainRowerId: "DUMMY:captain",
    startDateTime: "2025-01-01T08:00:00.000Z",
    comment: "",
    endDateTime: null,
  });

  const getPayload = () => ({
    sessionId: SESSION_ID,
    endDateTime: END,
    comment: "",
    incident: { checked: true, message: "Hit a buoy" },
    coached: false,
  });

  let outing: OngoingOuting | undefined;
  const sessionStore = {
    getOngoingSession: vi.fn((): OngoingOuting | undefined => outing),
    removeSession: vi.fn(),
  };
  const sessionDatabaseRepository = {
    finishSession: vi.fn(() => Promise.resolve(asOk(null))),
  };
  const incidentStore = { addIncident: vi.fn() };
  const damageReporter = { reportDamage: vi.fn() };

  const getUsecase = () =>
    new StopSession(
      sessionStore,
      sessionDatabaseRepository,
      incidentStore,
      damageReporter,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    outing = getOuting();
  });

  it("records the incident without any damage by default", async () => {
    const result = await getUsecase().execute(getPayload());

    expect(result).toEqual(asOk("success"));
    expect(incidentStore.addIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hit a buoy",
        sessionId: SESSION_ID,
        boatId: BOAT_ID,
        datetime: END_ISO,
      }),
    );
    expect(damageReporter.reportDamage).not.toHaveBeenCalled();
    expect(sessionStore.removeSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("reports a damage linked to the outing and to the incident", async () => {
    await getUsecase().execute({
      ...getPayload(),
      damage: { severity: "limited" },
    });

    const incident = incidentStore.addIncident.mock.calls[0][0] as {
      id: string;
    };
    expect(damageReporter.reportDamage).toHaveBeenCalledTimes(1);
    expect(damageReporter.reportDamage).toHaveBeenCalledWith({
      boatId: BOAT_ID,
      severity: "limited",
      description: "Hit a buoy",
      outingId: SESSION_ID,
      incidentId: incident.id,
      reportedByRowerId: "DUMMY:captain",
      reportedAt: END_ISO,
    });
  });

  it("reports the damage without a rower when the outing has no captain", async () => {
    outing = { ...getOuting(), captainRowerId: null };

    await getUsecase().execute({
      ...getPayload(),
      damage: { severity: "unusable" },
    });

    expect(damageReporter.reportDamage).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "unusable",
        reportedByRowerId: null,
      }),
    );
  });

  it("reports the damage by the single sculler when there is no captain", async () => {
    outing = {
      ...getOuting(),
      captainRowerId: null,
      rowers: [{ id: "DUMMY:sculler", name: "Sculler", role: "rower" }],
    };

    await getUsecase().execute({
      ...getPayload(),
      damage: { severity: "limited" },
    });

    expect(damageReporter.reportDamage).toHaveBeenCalledWith(
      expect.objectContaining({ reportedByRowerId: "DUMMY:sculler" }),
    );
  });

  it("does not count the cox as the single sculler", async () => {
    outing = {
      ...getOuting(),
      captainRowerId: null,
      rowers: [
        { id: "DUMMY:sculler", name: "Sculler", role: "rower" },
        { id: "DUMMY:cox", name: "Cox", role: "cox" },
      ],
    };

    await getUsecase().execute({
      ...getPayload(),
      damage: { severity: "limited" },
    });

    expect(damageReporter.reportDamage).toHaveBeenCalledWith(
      expect.objectContaining({ reportedByRowerId: "DUMMY:sculler" }),
    );
  });

  it("leaves the damage reason empty when the incident has no details", async () => {
    await getUsecase().execute({
      ...getPayload(),
      incident: { checked: true, message: "" },
      damage: { severity: "unusable" },
    });

    expect(damageReporter.reportDamage).toHaveBeenCalledWith(
      expect.objectContaining({ description: "" }),
    );
  });

  it("never dates a damage after now, so it can be repaired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T08:01:00.000Z"));
    try {
      await getUsecase().execute({
        ...getPayload(),
        damage: { severity: "limited" },
      });
    } finally {
      vi.useRealTimers();
    }

    expect(damageReporter.reportDamage).toHaveBeenCalledWith(
      expect.objectContaining({ reportedAt: "2025-01-01T08:01:00.000Z" }),
    );
  });

  it("does not report a damage when there is no incident", async () => {
    await getUsecase().execute({
      ...getPayload(),
      incident: { checked: false, message: undefined },
      damage: { severity: "usable" },
    });

    expect(incidentStore.addIncident).not.toHaveBeenCalled();
    expect(damageReporter.reportDamage).not.toHaveBeenCalled();
  });

  it("reports nothing when the outing cannot be saved", async () => {
    sessionDatabaseRepository.finishSession.mockResolvedValueOnce(
      asError({ code: "FAILED_TO_SAVE_SESSION" as const }) as never,
    );

    const result = await getUsecase().execute({
      ...getPayload(),
      damage: { severity: "limited" },
    });

    expect(result).toEqual(asError({ code: "FAILED_TO_SAVE_SESSION" }));
    expect(incidentStore.addIncident).not.toHaveBeenCalled();
    expect(damageReporter.reportDamage).not.toHaveBeenCalled();
  });

  it("refuses an end before the start", async () => {
    const result = await getUsecase().execute({
      ...getPayload(),
      endDateTime: "2024-12-31T10:00",
      damage: { severity: "limited" },
    });

    expect(result).toEqual(asError({ code: "END_DATE_BEFORE_START_DATE" }));
    expect(damageReporter.reportDamage).not.toHaveBeenCalled();
  });
});
