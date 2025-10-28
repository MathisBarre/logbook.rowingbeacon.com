import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useLocaleStore,
  LOCALES,
  LOCALE_NAMES,
  Locale,
  TimeStyle,
} from "../_common/store/locale.store";
import { changeLanguage } from "../_common/i18n/config";
import Button from "../_common/components/Button";
import { Check, GlobeIcon, Clock } from "lucide-react";

export const LocaleSelectionScreen = ({
  onComplete,
}: {
  onComplete: () => void;
}) => {
  const { t } = useTranslation();
  const { setLocale, setTimeStyle } = useLocaleStore();
  const [selectedLocale, setSelectedLocale] = useState<Locale | null>(null);
  const [selectedTimeStyle, setSelectedTimeStyle] = useState<TimeStyle>("24h");

  const handleConfirm = () => {
    if (selectedLocale) {
      setLocale(selectedLocale);
      setTimeStyle(selectedTimeStyle);
      changeLanguage(selectedLocale);
      onComplete();
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative bg-gradient-to-br from-steel-blue-50 to-steel-blue-100">
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-steel-blue-100 rounded-full">
              <GlobeIcon className="w-12 h-12 text-steel-blue-700" />
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">
            {t("localeSelection.title")}
          </h1>
          <p className="text-gray-600 text-center mb-6">
            {t("localeSelection.description")}
          </p>

          <div className="flex flex-col gap-2 mb-6">
            {LOCALES.map((locale) => (
              <button
                key={locale}
                onClick={() => {
                  setSelectedLocale(locale);
                  changeLanguage(locale);
                }}
                className={`
                  flex items-center justify-between p-4 rounded-lg border-2 transition-all
                  ${
                    selectedLocale === locale
                      ? "border-steel-blue-600 bg-steel-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }
                `}
              >
                <span className="font-medium text-gray-900">
                  {LOCALE_NAMES[locale]}
                </span>
                {selectedLocale === locale && (
                  <Check className="w-5 h-5 text-steel-blue-600" />
                )}
              </button>
            ))}
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                {t("localeSelection.timeFormat")}
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTimeStyle("12h")}
                className={`
                  flex-1 flex items-center justify-center p-3 rounded-lg border-2 transition-all
                  ${
                    selectedTimeStyle === "12h"
                      ? "border-steel-blue-600 bg-steel-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }
                `}
              >
                <span className="font-medium text-gray-900">
                  12h
                  {selectedTimeStyle === "12h" && (
                    <Check className="w-4 h-4 inline-block ml-2 text-steel-blue-600" />
                  )}
                </span>
              </button>
              <button
                onClick={() => setSelectedTimeStyle("24h")}
                className={`
                  flex-1 flex items-center justify-center p-3 rounded-lg border-2 transition-all
                  ${
                    selectedTimeStyle === "24h"
                      ? "border-steel-blue-600 bg-steel-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }
                `}
              >
                <span className="font-medium text-gray-900">
                  24h
                  {selectedTimeStyle === "24h" && (
                    <Check className="w-4 h-4 inline-block ml-2 text-steel-blue-600" />
                  )}
                </span>
              </button>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedLocale}
            className="w-full flex items-center justify-center gap-2"
          >
            {t("common.confirm")}
            <Check className="w-4 h-4" />
          </Button>
        </div>
      </main>
    </div>
  );
};
