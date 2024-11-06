import { ChangeEvent } from "react";
import { Label } from "../../../_common/components/Label";

const EndDatetimeSection = ({
  value,
  onChange,
  errorMessage,
}: {
  value: string;
  onChange: (newValue: ChangeEvent<HTMLInputElement>) => void;
  errorMessage?: string;
}) => {
  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>Date et heure de fin estimée</Label>
      <input
        className="input"
        type="datetime-local"
        value={value}
        onChange={onChange}
      />
      {errorMessage && <p className="text-xs text-error-600">{errorMessage}</p>}
    </div>
  );
};

export default EndDatetimeSection;
