import { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";

const StartDatetimeSection = ({
  value,
  onChange,
  errorMessage,
}: {
  value: string;
  onChange: (newValue: ChangeEvent<HTMLInputElement>) => void;
  errorMessage?: string;
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>{t("session.startDateTime")}</Label>
      <input
        className="input"
        type="datetime-local"
        value={value}
        onChange={onChange}
      />
      {errorMessage && <p className="form-error">{errorMessage}</p>}
    </div>
  );
};

export default StartDatetimeSection;
