# i18n Implementation Guide

## ✅ Completed

### Infrastructure

- ✅ Installed `i18next` and `react-i18next`
- ✅ Created i18n configuration (`src/_common/i18n/config.ts`)
- ✅ Created locale store (`src/_common/store/locale.store.ts`)
- ✅ Created translation files for all 9 locales:
  - en-US (English - United States) **FALLBACK**
  - en-GB (English - United Kingdom)
  - en-CA (English - Canada)
  - en-AU (English - Australia)
  - en-NZ (English - New Zealand)
  - fr-FR (French - France)
  - de-DE (German - Germany)
  - it-IT (Italian - Italy)
  - nl-NL (Dutch - Netherlands)

### Components

- ✅ Locale selection screen (`src/localeSelection/LocaleSelection.screen.tsx`)
- ✅ Locale selector component (`src/_common/components/LocaleSelector.tsx`)
- ✅ Integrated into Router (`src/Router.tsx`)
- ✅ Integrated into main app (`src/main.tsx`)

### Translated Screens & Components

- ✅ Router.tsx - Error fallback
- ✅ NavigationBar.tsx - Full navigation with all labels and dialogs
- ✅ Boathouse.screen.tsx - Boathouse screen with boat lists
- ✅ Parameters.screen.tsx - Parameter navigation tabs
- ✅ Stats.screen.tsx - Statistics screen with month names and stats
- ✅ Onboarding.screen.tsx - Complete onboarding flow
- ✅ SessionLogs.tsx - Session history with pagination
- ✅ StartSession.Dialog.tsx - Start session dialog
- ✅ StopSession.Dialog.tsx - Stop session dialog

### Utilities

- ✅ Created `boat.rules.i18n.ts` for translated boat type labels

## 🔄 In Progress / Remaining

### Components Still Needing Translation (~70+ files)

Use this pattern for each component:

#### Pattern to Follow:

1. **Import useTranslation**:

```typescript
import { useTranslation } from "react-i18next";
```

2. **Add in component**:

```typescript
const { t } = useTranslation();
```

3. **Replace hardcoded strings**:

```typescript
// Before:
<button>Valider</button>

// After:
<button>{t("common.confirm")}</button>
```

#### Priority Files to Translate:

**Boathouse Components:**

- `src/boathouse/components/StartSessionDialog/StartSession.Form.tsx`
- `src/boathouse/components/StartSessionDialog/BoatSection.tsx`
- `src/boathouse/components/StartSessionDialog/RowersSection.tsx`
- `src/boathouse/components/StartSessionDialog/RouteSection.tsx`
- `src/boathouse/components/StartSessionDialog/CommentSection.tsx`
- `src/boathouse/components/StartSessionDialog/StartDatetimeSection.tsx`
- `src/boathouse/components/StartSessionDialog/DurationEstimationSelect.tsx`
- `src/boathouse/components/StopSessionDialog/StopSession.Form.tsx`
- `src/boathouse/components/BoatList/*.tsx`

**Logbook Components:**

- `src/logbook/components/IncidentLogs.tsx`
- `src/logbook/components/IncidentLogsTable.tsx`
- `src/logbook/components/SessionLogsTable.tsx`
- `src/logbook/components/ExportSessions.tsx`

**Parameters Components:**

- `src/parameters/components/RowersCrud.tsx`
- `src/parameters/components/BoatsCrud.tsx`
- `src/parameters/components/MiscParams.tsx`
- `src/parameters/components/UpdateRower.tsx`
- `src/parameters/components/UpdateBoat.tsx`
- `src/parameters/components/BulkUpdateRower.tsx`
- `src/parameters/components/RowerStats.tsx`
- `src/parameters/components/BoatStats.tsx`
- `src/parameters/components/RowerStatsComparisons.tsx`
- `src/parameters/components/BoatStatsComparisons.tsx`
- `src/parameters/components/RouteConfigModal.tsx`
- `src/parameters/components/BoatLevelConfigModal.tsx`
- `src/parameters/components/BoatLevelSystem.tsx`
- `src/parameters/components/DeleteDatas.tsx`
- `src/parameters/components/dialogs/*.tsx`

**Stats Components:**

- `src/stats/components/SeasonSelector.tsx`
- `src/stats/components/MonthSelector.tsx`
- `src/stats/components/StackedBarChart.tsx`

**Common Components:**

- `src/_common/components/Loading.tsx`
- `src/_common/components/ErrorBlock.tsx`
- `src/_common/components/WindowAlert.tsx`
- `src/_common/components/WindowConfirm.tsx`
- `src/_common/components/WindowPrompt.tsx`

### Adding New Translation Keys

When you find a string that needs translation:

1. **Add to `src/_common/i18n/locales/en-US.json`** (English base):

```json
{
  "category": {
    "newKey": "New English Text"
  }
}
```

2. **Add to `src/_common/i18n/locales/fr-FR.json`** (French):

```json
{
  "category": {
    "newKey": "Nouveau texte français"
  }
}
```

3. **Add to all other locale files** with appropriate translations.

### Common Translation Categories

The translation files are organized into these categories:

- `common`: General UI elements (buttons, labels, etc.)
- `navigation`: App navigation and menus
- `onboarding`: Onboarding/setup flow
- `boathouse`: Boathouse screen specific
- `session`: Session management (start, stop, details)
- `logbook`: Logbook and history
- `stats`: Statistics screen
- `parameters`: Settings/parameters screen
- `boat`: Boat-related terms
- `rower`: Rower-related terms
- `error`: Error messages
- `time`: Time-related terms

### Using Translation with Parameters

For dynamic values:

```typescript
// In translation file:
"pageOf": "Page {{current}} of {{total}}"

// In component:
{t("session.pageOf", { current: 5, total: 10 })}
// Output: "Page 5 of 10"
```

### Pluralization

For plurals, use the i18next convention:

```json
{
  "session_one": "{{count}} session",
  "session_other": "{{count}} sessions"
}
```

Then use:

```typescript
t(`stats.session_${count === 1 ? "one" : "other"}`, { count });
```

### Boat Type Labels

Use the utility function for boat type labels:

```typescript
import { getTypeLabelTranslated } from "../_common/business/boat.rules.i18n";

// In component:
const label = getTypeLabelTranslated(boatType, t);
```

## 📋 Testing

1. **Test Locale Selection**: On first launch, you should see the locale selection screen
2. **Test Translations**: Change locale and verify text changes
3. **Test Fallback**: If a translation is missing, it should fall back to en-US

## 🔧 Development Commands

```bash
# Run dev server
yarn dev

# Build (includes TypeScript check and tests)
yarn build

# Type check only
yarn tsc

# Lint
yarn lint
```

## 📝 Quick Reference

### Import Pattern

```typescript
import { useTranslation } from "react-i18next";

export const MyComponent = () => {
  const { t } = useTranslation();

  return <div>{t("category.key")}</div>;
};
```

### Change Language Programmatically

```typescript
import { changeLanguage } from "../_common/i18n/config";
import { Locale } from "../_common/store/locale.store";

changeLanguage("fr-FR" as Locale);
```

### Access Current Locale

```typescript
import { useLocaleStore } from "../_common/store/locale.store";

const { locale } = useLocaleStore();
```

## 🎯 Next Steps

1. Go through each component file in the priority list
2. Add `useTranslation` hook
3. Replace hardcoded strings with `t()` calls
4. Add missing translation keys to all 9 locale files
5. Test each screen by switching locales
6. Update utility functions that return user-facing text

## 📚 Resources

- [i18next Documentation](https://www.i18next.com/)
- [react-i18next Documentation](https://react.i18next.com/)
- Translation files: `src/_common/i18n/locales/*.json`
