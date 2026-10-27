import { Trans } from "react-i18next";
import { TFunction } from "i18next";

export function InvalidRowersLevelText({
  t,
  nbOfInvalidRowers,
}: {
  t: TFunction;
  nbOfInvalidRowers: number;
}) {
  return (
    <Trans
      t={t}
      i18nKey="session.alert.invalidRowersLevel"
      count={nbOfInvalidRowers}
      components={[<strong key="count" />]}
    />
  );
}
