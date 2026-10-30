// Checks a content pack against the rules written in content/types.ts and
// throws one error listing every problem, so a pack is fixed in one go.
import { simplifyString } from "../../_common/utils/string.utils";
import type { LocaleContent } from "./content/types";

export const LIMITS = {
  firstNames: 60,
  lastNames: 120,
  boatNames: 38,
  boatNameLength: 14,
  routes: 5,
  routeLength: 28,
  outingComments: 20,
  outingCommentLength: 60,
  incidents: 20,
  incidentLength: 80,
  coachNoteLength: 90,
  scenarioCommentLength: 60,
  scenarioIncidentLength: 80,
  queryTitleLength: 80,
  queryDescriptionLength: 160,
  annualNoteLength: 600,
  aiQuestionLength: 120,
  reservationHolderLength: 40,
  reservationReasonLength: 50,
  reservationContactLength: 50,
  demoGuests: 5,
  demoNoteLength: 80,
  demoGuestNoteLength: 60,
  demoMemberNotes: 6,
  demoStreets: 8,
  demoTowns: 4,
  demoDamagesPerSeverity: 2,
  demoRepairNotes: 8,
} as const;

const LOCALES = ["fr-FR", "en-US", "en-GB", "de-DE", "it-IT", "nl-NL"];

/** Titles, suffixes and degrees that have no place in a member list. */
const TITLE_OR_SUFFIX =
  /(^|[\s,.])(phd|ph\.d|md|dds|esq|jr|sr|ii|iii|iv|mr|mrs|ms|dr|prof|dipl|ing|sig|sra|dott|mme|mlle|m\.)(\.|$|[\s,])/i;

const checkList = (
  problems: string[],
  path: string,
  list: unknown,
  { min, maxLength }: { min: number; maxLength?: number }
) => {
  if (!Array.isArray(list)) {
    problems.push(`${path} must be a list`);
    return;
  }
  if (list.length < min) {
    problems.push(`${path} has ${list.length} entries, at least ${min} needed`);
  }
  const seen = new Map<string, string>();
  list.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`${path}[${index}] is empty`);
      return;
    }
    if (entry !== entry.trim() || /\s{2,}/.test(entry)) {
      problems.push(`${path}[${index}] "${entry}" has extra spaces`);
    }
    if (maxLength !== undefined && entry.length > maxLength) {
      problems.push(
        `${path}[${index}] "${entry}" is ${entry.length} characters long, at most ${maxLength}`
      );
    }
    // Accents and case apart, as the app's search compares names.
    const key = simplifyString(entry);
    const previous = seen.get(key);
    if (previous !== undefined) {
      problems.push(`${path}[${index}] "${entry}" repeats "${previous}"`);
    } else {
      seen.set(key, entry);
    }
  });
};

const checkText = (
  problems: string[],
  path: string,
  text: unknown,
  maxLength: number
) => {
  if (typeof text !== "string" || text.trim() === "") {
    problems.push(`${path} is empty`);
  } else if (text.length > maxLength) {
    problems.push(
      `${path} "${text}" is ${text.length} characters long, at most ${maxLength}`
    );
  }
};

/** Throws when the pack breaks a rule of LocaleContent. */
export const validateContent = (content: LocaleContent) => {
  const problems: string[] = [];

  if (!LOCALES.includes(content.locale))
    problems.push(`locale "${content.locale}" is not a studio locale`);
  const expectedTimeStyle = content.locale === "en-US" ? "12h" : "24h";
  if (content.timeStyle !== expectedTimeStyle) {
    problems.push(
      `timeStyle is "${content.timeStyle}", ${content.locale} uses "${expectedTimeStyle}"`
    );
  }
  checkText(problems, "clubName", content.clubName, 80);
  checkText(problems, "efa2ProjectName", content.efa2ProjectName, 80);

  checkList(problems, "firstNames.female", content.firstNames?.female, {
    min: LIMITS.firstNames,
    maxLength: 30,
  });
  checkList(problems, "firstNames.male", content.firstNames?.male, {
    min: LIMITS.firstNames,
    maxLength: 30,
  });
  checkList(problems, "lastNames", content.lastNames, {
    min: LIMITS.lastNames,
    maxLength: 30,
  });
  for (const [path, list] of [
    ["firstNames.female", content.firstNames?.female],
    ["firstNames.male", content.firstNames?.male],
    ["lastNames", content.lastNames],
  ] as const) {
    (list ?? []).forEach((name, index) => {
      if (TITLE_OR_SUFFIX.test(name))
        problems.push(`${path}[${index}] "${name}" holds a title or suffix`);
      if (/\d/.test(name))
        problems.push(`${path}[${index}] "${name}" holds a digit`);
    });
  }

  checkList(problems, "boatNames", content.boatNames, {
    min: LIMITS.boatNames,
    maxLength: LIMITS.boatNameLength,
  });
  if (
    Array.isArray(content.boatNames) &&
    content.boatNames.length > LIMITS.boatNames
  ) {
    problems.push(
      `boatNames has ${content.boatNames.length} entries, exactly ${LIMITS.boatNames} needed (one per boat, in fleet order)`
    );
  }
  checkList(problems, "routes", content.routes, {
    min: LIMITS.routes,
    maxLength: LIMITS.routeLength,
  });
  const routeCount = Array.isArray(content.routes)
    ? (content.routes as readonly string[]).length
    : LIMITS.routes;
  if (routeCount !== LIMITS.routes) {
    problems.push(
      `routes has ${routeCount} entries, exactly ${LIMITS.routes} needed`
    );
  }
  checkList(problems, "outingComments", content.outingComments, {
    min: LIMITS.outingComments,
    maxLength: LIMITS.outingCommentLength,
  });
  checkList(problems, "incidents", content.incidents, {
    min: LIMITS.incidents,
    maxLength: LIMITS.incidentLength,
  });

  checkText(problems, "coachNote", content.coachNote, LIMITS.coachNoteLength);
  checkText(
    problems,
    "scenario.startComment",
    content.scenario?.startComment,
    LIMITS.scenarioCommentLength
  );
  checkText(
    problems,
    "scenario.stopComment",
    content.scenario?.stopComment,
    LIMITS.scenarioCommentLength
  );
  checkText(
    problems,
    "scenario.stopIncident",
    content.scenario?.stopIncident,
    LIMITS.scenarioIncidentLength
  );

  checkText(problems, "scenario.guestName", content.scenario?.guestName, 40);
  const profile = content.scenario?.memberProfile;
  checkText(
    problems,
    "scenario.memberProfile.licenseNumber",
    profile?.licenseNumber,
    20
  );
  checkText(problems, "scenario.memberProfile.phone", profile?.phone, 20);
  checkText(problems, "scenario.memberProfile.address", profile?.address, 80);
  checkText(problems, "scenario.memberProfile.note", profile?.note, 100);

  const analytics = content.analytics;
  const queries = [
    ...Object.entries(analytics?.queries ?? {}),
    ["proposal", analytics?.proposal] as const,
  ];
  if (Object.keys(analytics?.queries ?? {}).length !== 5)
    problems.push("analytics.queries needs its 5 queries");
  for (const [key, query] of queries) {
    checkText(
      problems,
      `analytics.queries.${key}.title`,
      query?.title,
      LIMITS.queryTitleLength
    );
    checkText(
      problems,
      `analytics.queries.${key}.description`,
      query?.description,
      LIMITS.queryDescriptionLength
    );
  }
  checkList(
    problems,
    "analytics query titles",
    queries.map(([, query]) => query?.title),
    { min: 6 }
  );
  checkText(
    problems,
    "analytics.annualNote",
    analytics?.annualNote,
    LIMITS.annualNoteLength
  );
  checkText(
    problems,
    "analytics.aiQuestion",
    analytics?.aiQuestion,
    LIMITS.aiQuestionLength
  );
  checkText(
    problems,
    "analytics.aiVagueQuestion",
    analytics?.aiVagueQuestion,
    LIMITS.aiQuestionLength
  );

  for (const [name, holder] of Object.entries(
    content.reservations?.holders ?? {}
  )) {
    checkText(
      problems,
      `reservations.holders.${name}`,
      holder,
      LIMITS.reservationHolderLength
    );
  }
  for (const [name, reason] of Object.entries(
    content.reservations?.reasons ?? {}
  )) {
    checkText(
      problems,
      `reservations.reasons.${name}`,
      reason,
      LIMITS.reservationReasonLength
    );
  }
  checkText(
    problems,
    "reservations.regattaContact",
    content.reservations?.regattaContact,
    LIMITS.reservationContactLength
  );
  for (const key of ["juniors", "regatta", "initiation"] as const) {
    if (!content.reservations?.holders?.[key])
      problems.push(`reservations.holders.${key} is missing`);
  }
  for (const key of [
    "juniors",
    "regatta",
    "initiation",
    "masters",
    "competition",
  ] as const) {
    if (!content.reservations?.reasons?.[key])
      problems.push(`reservations.reasons.${key} is missing`);
  }

  const demo = content.demo;
  if (!demo) {
    problems.push("demo is missing");
  } else {
    if (
      !Array.isArray(demo.guests) ||
      demo.guests.length !== LIMITS.demoGuests
    ) {
      problems.push(`demo.guests needs exactly ${LIMITS.demoGuests} entries`);
    } else {
      demo.guests.forEach((guest, index) => {
        checkText(
          problems,
          `demo.guests[${index}].firstName`,
          guest.firstName,
          30
        );
        checkText(
          problems,
          `demo.guests[${index}].lastName`,
          guest.lastName,
          30
        );
        checkText(
          problems,
          `demo.guests[${index}].note`,
          guest.note,
          LIMITS.demoGuestNoteLength
        );
      });
    }
    checkText(
      problems,
      "demo.contacts.emailDomain",
      demo.contacts?.emailDomain,
      40
    );
    if (!demo.contacts?.emailDomain?.endsWith(".example")) {
      problems.push("demo.contacts.emailDomain must end with .example");
    }
    checkList(problems, "demo.contacts.streets", demo.contacts?.streets, {
      min: LIMITS.demoStreets,
      maxLength: 40,
    });
    checkList(problems, "demo.contacts.towns", demo.contacts?.towns, {
      min: LIMITS.demoTowns,
      maxLength: 40,
    });
    checkList(problems, "demo.memberNotes", demo.memberNotes, {
      min: LIMITS.demoMemberNotes,
      maxLength: LIMITS.demoNoteLength,
    });
    for (const severity of ["usable", "limited"] as const) {
      checkList(
        problems,
        `demo.damages.${severity}`,
        demo.damages?.[severity],
        {
          min: LIMITS.demoDamagesPerSeverity,
          maxLength: LIMITS.demoNoteLength,
        }
      );
    }
    checkList(problems, "demo.repairNotes", demo.repairNotes, {
      min: LIMITS.demoRepairNotes,
      maxLength: LIMITS.demoNoteLength,
    });
  }

  if (problems.length > 0) {
    throw new Error(
      `Content pack ${content.locale} is invalid:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
    );
  }
};
