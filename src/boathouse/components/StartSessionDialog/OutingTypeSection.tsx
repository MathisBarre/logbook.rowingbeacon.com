import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";
import {
  BUILTIN_OUTING_TYPE_CODES,
  getOutingTypeLabel,
} from "../../../_common/business/outingType.rules";

export const OutingTypeSection = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string) => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>{t("session.outingType")}</Label>
      <select
        name="outingType"
        className="input"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {BUILTIN_OUTING_TYPE_CODES.map((code) => (
          <option key={code} value={code}>
            {getOutingTypeLabel(code)}
          </option>
        ))}
      </select>
    </div>
  );
};
