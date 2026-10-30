import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MODULE_IDS, ModuleId } from "../../_common/business/modules.rules";
import { Checkbox } from "../../_common/components/Checkbox";
import { useModulesStore } from "../../_common/store/modules.store";
import { useReservationStore } from "../../_common/store/reservation.store";

const CHECKBOX_CLASS =
  "h-5 w-5 border-steel-blue-800 data-[state=checked]:bg-steel-blue-800 data-[state=checked]:text-white";

export const ModulesParams = () => {
  const { t } = useTranslation();

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          {t("modules.title")}
        </h1>
      </div>
      <div className="flex-1 relative">
        <div className="p-6 flex flex-col gap-6 absolute inset-0 overflow-auto">
          <p className="text-gray-500 max-w-3xl">{t("modules.intro")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MODULE_IDS.map((id) => (
              <ModuleCard key={id} id={id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ModuleCard = ({ id }: { id: ModuleId }) => {
  const { t } = useTranslation();
  const isEnabled = useModulesStore((state) => state.enabled.includes(id));
  const enable = useModulesStore((state) => state.enable);
  const disable = useModulesStore((state) => state.disable);
  const checkboxId = `module-${id}`;

  return (
    <section
      className={
        "border rounded-lg p-4 flex flex-col gap-2" +
        (isEnabled ? " border-steel-blue-600 bg-steel-blue-50" : "")
      }
    >
      <div className="flex items-center gap-3">
        <Checkbox
          id={checkboxId}
          className={CHECKBOX_CLASS}
          checked={isEnabled}
          onCheckedChange={(checked) => {
            if (checked === true) {
              enable(id);
            } else {
              disable(id);
            }
          }}
        />
        <label
          htmlFor={checkboxId}
          className="font-bold text-lg text-gray-900 cursor-pointer"
        >
          {t(`modules.${id}.name`)}
        </label>
      </div>
      <p className="text-gray-600">{t(`modules.${id}.description`)}</p>
      <p className="text-sm text-gray-500">{t(`modules.${id}.adds`)}</p>
      {id === "captain" && isEnabled && <CaptainOptions />}
      {id === "reservations" && isEnabled && <ReservationsOptions />}
    </section>
  );
};

const CaptainOptions = () => {
  const { t } = useTranslation();
  const captainRequired = useModulesStore((state) => state.captainRequired);
  const setCaptainRequired = useModulesStore(
    (state) => state.setCaptainRequired
  );

  return (
    <div className="flex items-center gap-3 mt-2 pt-2 border-t">
      <Checkbox
        id="captain-required"
        className={CHECKBOX_CLASS}
        checked={captainRequired}
        onCheckedChange={(checked) => setCaptainRequired(checked === true)}
      />
      <label htmlFor="captain-required" className="text-sm cursor-pointer">
        {t("modules.captain.requiredOption")}
      </label>
    </div>
  );
};

const MAX_LOOKAHEAD_MINUTES = 1440;

const ReservationsOptions = () => {
  const { t } = useTranslation();
  const lookaheadMinutes = useReservationStore(
    (state) => state.lookaheadMinutes
  );
  const setLookaheadMinutes = useReservationStore(
    (state) => state.setLookaheadMinutes
  );
  // What is typed; saved when the field is left, once it is a valid number.
  const [typed, setTyped] = useState<string | null>(null);

  const commit = () => {
    const minutes = Math.round(Number(typed));
    if (typed !== null && typed.trim() !== "" && Number.isFinite(minutes)) {
      setLookaheadMinutes(
        Math.min(Math.max(minutes, 0), MAX_LOOKAHEAD_MINUTES)
      );
    }
    setTyped(null);
  };

  // The sentence keeps its own word order in every language.
  const [before, after] = t("modules.reservations.lookahead", {
    minutes: "\u0000",
  }).split("\u0000");

  return (
    <label className="flex items-center gap-2 mt-2 pt-2 border-t text-sm">
      {before}
      <input
        type="number"
        min={0}
        max={MAX_LOOKAHEAD_MINUTES}
        step={5}
        className="input w-20 !mt-0 py-1"
        value={typed ?? lookaheadMinutes}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {after}
    </label>
  );
};
