import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";
import { CrewOption } from "./RowersSection";

/** Captain module: the person responsible for the crew. */
export const CaptainSection = ({
  crew,
  value,
  onChange,
  isRequired,
  errorMessage,
}: {
  crew: CrewOption[];
  value: string | null;
  onChange: (captainId: string | null) => void;
  isRequired: boolean;
  errorMessage?: string;
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>
        {t("session.captain")}
        {isRequired && <span className="text-error-700"> *</span>}
      </Label>
      <select
        name="captain"
        className="input"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t("session.noCaptain")}</option>
        {crew.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      {errorMessage && <p className="form-error">{errorMessage}</p>}
    </div>
  );
};
