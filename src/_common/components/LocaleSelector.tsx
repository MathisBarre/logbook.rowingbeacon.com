import { useTranslation } from "react-i18next";
import {
  useLocaleStore,
  LOCALES,
  LOCALE_NAMES,
  Locale,
} from "../store/locale.store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";
import { changeLanguage } from "../i18n/config";

export const LocaleSelector = () => {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocaleStore();

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    changeLanguage(newLocale);
  };

  return (
    <Select
      value={locale || "en-US"}
      onValueChange={(value) => handleLocaleChange(value as Locale)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("localeSelection.selectPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {LOCALE_NAMES[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
