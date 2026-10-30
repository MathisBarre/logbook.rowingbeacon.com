// Everything a locale contributes to the fake club. Structure (boats, crews, schedule) is shared
// across locales so counts and charts match; only these strings change.
// Seeding throws when a list is shorter than its minimum or contains duplicates.

export type StudioLocale =
  | "fr-FR"
  | "en-US"
  | "en-GB"
  | "de-DE"
  | "it-IT"
  | "nl-NL";

export interface LocaleContent {
  locale: StudioLocale;
  /** "12h" for en-US, "24h" elsewhere. */
  timeStyle: "12h" | "24h";
  /** Fictional but plausible club, e.g. "Aviron Club de la Marne". Never a real club. */
  clubName: string;
  /** Name shown in the efa2 import preview, usually the club name. */
  efa2ProjectName: string;
  /** Realistic, common given names for the locale; at least 60 each, unique. */
  firstNames: { female: string[]; male: string[] };
  /** Realistic family names for the locale; at least 120, unique. No titles or suffixes ("PhD", "Jr."). */
  lastNames: string[];
  /**
   * Exactly 38 boat names, one per boat in fleet order (see BOAT_PLANS in club.ts): 3 racing singles,
   * the junior single, 6 club singles, 6 beginners' singles, 2 racing doubles, 6 club doubles, 2 pairs,
   * 5 quads, 3 coxed fours, 3 eights, the launch. Like a real fleet, racing boats and eights carry
   * names (rivers, birds, patrons, towns; fictional people only) while training boats carry a
   * builder code and number (F101 for a Filippi single, E4x 2 for an Empacher quad, W for Wintech,
   * V Vespoli, S Swift, J Janousek...), numbered by class. Unique, max 14 characters.
   */
  boatNames: string[];
  /** Exactly 5 route names, ordered by distance: 4, 6, 8, 12 and 16 km. Max 28 characters. */
  routes: [string, string, string, string, string];
  /** Short notes rowers leave on an outing ("3 x 1000 m at race pace"); at least 20, unique, max 60 characters. */
  outingComments: string[];
  /** Short incident reports ("Bow ball loose on the stroke side"); at least 20, unique, max 80 characters. */
  incidents: string[];
  /** One-line note from the coach shown in the boathouse banner (max 90 characters). */
  coachNote: string;
  /** Texts typed in the start/stop dialogs of the featured scenes. */
  scenario: {
    /** Comment typed when starting the featured outing (max 60 characters). */
    startComment: string;
    /** Comment typed when ending the featured outing (max 60 characters). */
    stopComment: string;
    /** Incident typed when ending the featured outing (max 80 characters). */
    stopIncident: string;
    /** Comment typed when entering an outing after the fact (max 60 characters). */
    lateComment: string;
    /** A guest typed in the start dialog (Guests module): the full name of nobody in the club (max 40 characters). */
    guestName: string;
    /**
     * The complete file of the featured rower (Member profile module): licence number, phone, address on two
     * lines ("\n"), a note. The e-mail is made from her name.
     */
    memberProfile: {
      licenseNumber: string;
      phone: string;
      address: string;
      note: string;
    };
  };
  /**
   * Release notes of the fictional 2.1.0 the update dialog offers (a short list of lines, as the
   * release notes of the real app: at most 9 lines, 70 characters each; the Logbook shows the
   * text as is).
   */
  updateNotes: string;
  /** Texts of the `analytics` seed profile (Statistiques scenes, see seed/analytics.ts). */
  analytics: AnalyticsContent;
  /**
   * Texts of the Damages module scenes (max 80 characters each, in the voice of a rower or
   * coach noting a defect; repair notes written by whoever repaired).
   */
  damages: {
    /** Precaution damage of the start dialog's quad. */
    warningLimited: string;
    /** Minor damage of the same quad. */
    warningUsable: string;
    /** Precaution damage of a club single. */
    precaution: string;
    /** Minor damage of a pair. */
    minor: string;
    /** Two damages repaired since: what was wrong, what was done, and what it cost (euros). */
    fixed: [
      { description: string; repairNote: string; repairCost: number },
      { description: string; repairNote: string; repairCost: number },
    ];
    /** Typed in the damage form (the quad of the statistics scenes). */
    formDescription: string;
  };
  /**
   * Texts of the boat reservations (Reservations module scenes). Holders are free names the
   * way a club types them (a group, a team); a rower holds some reservations by name.
   */
  reservations: {
    /** Free holder names: the junior group, the racing squad, the learn-to-row class (max 40 characters). */
    holders: { juniors: string; regatta: string; initiation: string };
    /** Why a boat is held, in a few words (max 50 characters each). */
    reasons: {
      juniors: string;
      regatta: string;
      initiation: string;
      /** A masters crew, held by one of its rowers. */
      masters: string;
      competition: string;
    };
    /** Contact line of the regatta reservation: a role and a fictional phone number (max 50 characters). */
    regattaContact: string;
  };
  /**
   * Texts only the Logbook demo club needs (the studio never reads them): guests, member profile
   * details, damages and repairs. Fictional and plausible for the locale.
   */
  demo: {
    /** Exactly 5 visiting rowers (status "guest"); `note` says where they come from (max 60 characters). */
    guests: { firstName: string; lastName: string; note: string }[];
    contacts: {
      /** Fictional e-mail domain of members, on a reserved ".example" domain. */
      emailDomain: string;
      /** At least 8 street names without number, written the way the locale writes them. */
      streets: string[];
      /** At least 4 postal code and town, e.g. "51000 Belle-Rive". */
      towns: string[];
    };
    /** Exactly 6 short notes on a member record (max 80 characters). */
    memberNotes: string[];
    /** Damage reports that fit any boat, exactly 2 of each open severity (max 80 characters). */
    damages: { usable: string[]; limited: string[] };
    /** At least 8 repair notes that fit any damage, unique (max 80 characters). */
    repairNotes: string[];
  };
}

/** A saved query of the Explorer: title max 80 characters, description max 160. */
export interface QueryText {
  title: string;
  description: string;
}

export interface AnalyticsContent {
  /** Saved queries, one per origin badge (Vous, IA, Claude (MCP), Rapport). */
  queries: {
    /** Written in the editor: outings of the Tuesday evening slot, month by month. */
    tuesdayEvenings: QueryText;
    /** Answer of the in-app assistant: active juniors per month (same as the AI fixture). */
    youthMonthly: QueryText;
    /** Proposed by Claude Desktop and accepted: hours on the water per boat class. */
    hoursPerClass: QueryText;
    /** Saved from the "Classement des bateaux" report, sculling boats only. */
    scullingBoats: QueryText;
    /** Written in the editor: kilometres per route this season. */
    kmPerRoute: QueryText;
  };
  /** The Claude Desktop proposal waiting in the inbox: late returns by day and hour. */
  proposal: QueryText;
  /** "Commentaire du club" of the annual report, 2 to 4 sentences, max 600 characters. */
  annualNote: string;
  /** Question typed in the AI assistant (boats out most at weekends: fixture answer-bar), max 120 characters. */
  aiQuestion: string;
  /**
   * The assistant's answer to `aiQuestion` (fixture answer-bar), in the club's language: what a
   * real assistant writes in the language of the question. The query and the chart stay the
   * fixture's. French is the fixture's own text.
   */
  aiAnswerBar: {
    title: string;
    explanation: string;
    assumptions: [string, string, string];
    /** Label of the season parameter. */
    seasonLabel: string;
  };
  /** Question typed before the assistant asks for a clarification, max 120 characters. */
  aiVagueQuestion: string;
  /** Question naming a rower ({{name}}: a seeded first name): the name check stops it. */
  aiNameQuestion: string;
  /** A Rapports search that matches no report (the AI is offered). */
  reportsNoMatchSearch: string;
}
