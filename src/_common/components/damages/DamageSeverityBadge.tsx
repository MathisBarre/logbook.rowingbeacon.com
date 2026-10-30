import { useTranslation } from "react-i18next";
import { DamageSeverity } from "../../database/repositories/club.types";
import { cn } from "../../utils/utils";

const SEVERITY_CLASS: Record<DamageSeverity, string> = {
  usable: "bg-gray-100 text-gray-800 border-gray-300",
  limited: "bg-yellow-100 text-yellow-900 border-yellow-600",
  unusable: "bg-error-100 text-error-900 border-error-600",
};

/** The severity of a damage as a small pill; neutral, amber or red. */
export const DamageSeverityBadge = ({
  severity,
  className,
}: {
  severity: DamageSeverity;
  className?: string;
}) => {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        SEVERITY_CLASS[severity],
        className
      )}
    >
      {t(`damages.severity.${severity}`)}
    </span>
  );
};
