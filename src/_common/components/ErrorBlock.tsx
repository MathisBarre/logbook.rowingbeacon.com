import { useTranslation } from "react-i18next";

interface ErrorBlockProps {
  message?: string;
  refetch?: () => void;
}

export const ErrorBlock = ({ message, refetch }: ErrorBlockProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex justify-between items-center bg-error-100 p-2 pl-4 rounded border-error-200 border">
      <div className="text-error-800 font-medium">
        {message ?? t("common.error")}
      </div>
      {refetch && (
        <button className="btn-error" onClick={() => refetch()}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
};
