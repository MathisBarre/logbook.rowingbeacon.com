import { faker } from "@faker-js/faker/locale/fr";

interface RowingSessionData {
  month: number;
  amount: number;
  label: string;
}

const ROWER_CATEGORIES = [
  { name: "J10", baseSessions: { min: 8, max: 15 } },
  { name: "J12", baseSessions: { min: 12, max: 20 } },
  { name: "J14", baseSessions: { min: 15, max: 25 } },
  { name: "J16", baseSessions: { min: 18, max: 30 } },
  { name: "Senior", baseSessions: { min: 20, max: 40 } },
];

export const generateRowingSessionData = (): RowingSessionData[] => {
  const data: RowingSessionData[] = [];

  // Generate data for each month
  for (let month = 1; month <= 12; month++) {
    // Seasonal factor to adjust number of sessions based on month
    const seasonalFactor = getSeasonalFactor(month);

    // Generate data for each category
    ROWER_CATEGORIES.forEach((category) => {
      // Base number of sessions with seasonal variation
      const baseSessions = faker.number.int(category.baseSessions);
      const adjustedSessions = Math.round(baseSessions * seasonalFactor);

      if (adjustedSessions > 0) {
        data.push({
          month,
          amount: adjustedSessions,
          label: category.name,
        });
      }
    });
  }

  return data;
};

// Helper function to get seasonal factor for each month
const getSeasonalFactor = (month: number): number => {
  // Summer months (June-August) have highest participation
  if (month >= 6 && month <= 8) return 1.2;

  // Spring and early fall (March-May, September-October) have moderate participation
  if ((month >= 3 && month <= 5) || (month >= 9 && month <= 10)) return 1.0;

  // Winter months (November-February) have lower participation
  if (month >= 11 || month <= 2) return 0.8;

  return 1.0;
};
