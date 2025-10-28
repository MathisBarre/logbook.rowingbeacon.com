import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";

type Value =
  | "na"
  | "15"
  | "30"
  | "45"
  | "60"
  | "75"
  | "90"
  | "105"
  | "120"
  | "135"
  | "150"
  | "165"
  | "180";

const DurationEstimationSelect = ({
  value,
  onChange,
  errorMessage,
}: {
  value: Value;
  onChange: (newValue: Value) => void;
  errorMessage?: string;
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>{t("session.estimatedDuration")}</Label>
      {/* select */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Value)}
        className="input"
        name="estimatedEndDateTime"
      >
        <option value="na">{t("session.noEstimation")}</option>
        <option value="15">~00h15</option>
        <option value="30">~00h30</option>
        <option value="45">~00h45</option>
        <option value="60">~01h00</option>
        <option value="75">~01h15</option>
        <option value="90">~01h30</option>
        <option value="105">~01h45</option>
        <option value="120">~02h00</option>
        <option value="135">~02h15</option>
        <option value="150">~02h30</option>
        <option value="165">~02h45</option>
        <option value="180">~03h00</option>
      </select>

      {errorMessage && <p className="form-error">{errorMessage}</p>}
    </div>
  );
};

export default DurationEstimationSelect;
