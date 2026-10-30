import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../../_common/i18n/config";
import {
  createBoat,
  createRower,
  useClubOverviewStore,
} from "../../../_common/store/clubOverview.store";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { getEmptyPastOutingDraft } from "../../business/EditOuting/outingDraft.rules";
import { OutingEditorForm } from "./OutingEditor.Form";

const boat = createBoat({
  id: "boat-1",
  name: "Aviron 4",
  type: BoatTypeEnum.FOUR_ROWERS_COXED,
});

const render = (mode: "past" | "ongoing" | "finished") =>
  renderToStaticMarkup(
    <OutingEditorForm
      mode={mode}
      initialDraft={{
        ...getEmptyPastOutingDraft(new Date("2026-10-01T10:00:00"), boat.id),
        id: mode === "past" ? undefined : "outing-1",
        rowerIds: ["rower-1"],
        endDateTime: mode === "ongoing" ? null : "2026-10-01T10:00",
        estimatedEndDateTime: mode === "ongoing" ? "2026-10-01T11:00" : null,
      }}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />
  );

describe("OutingEditorForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr-FR");
    useClubOverviewStore.setState({
      clubOverview: {
        club: { password: "" },
        boats: [boat],
        routes: [],
        rowers: [createRower("Jean Dupont", { id: "rower-1" })],
      },
    });
  });

  it("asks for the end of a past outing", () => {
    const html = render("past");

    expect(html).toContain("Date et heure de la fin");
    expect(html).toContain("Maintenant");
    expect(html).toContain("Enregistrer la sortie");
  });

  it("asks for the expected return of an ongoing outing, not an end", () => {
    const html = render("ongoing");

    expect(html).toContain("Retour prévu");
    expect(html).not.toContain("Date et heure de la fin");
    expect(html).toContain("Enregistrer les modifications");
  });
});
