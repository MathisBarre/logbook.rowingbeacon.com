import {
  SessionDatabaseRepository,
  SessionToSave,
} from "../business/StopSession/StopSession.usecase";
import { generateIncidenId } from "../../_common/business/incident.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getBoatNumberOfRowers } from "../../_common/business/boat.rules";
import { Boat } from "../../_common/business/boat.rules";
import { generateSessionId } from "../../_common/business/session.rules";

export const useGenerateFakeData = () => {
  const { getAllRoutes, getAllBoats, getAllRowers } = useClubOverviewStore();
  const sessionDatabaseRepository = new SessionDatabaseRepository();

  return async function generateFakeData() {
    const data: SessionToSave[] = [];
    const startDate = new Date("2024-01-01");
    const routes = getAllRoutes();
    const boats = getAllBoats();
    const rowers = getAllRowers();

    for (let i = 0; i < 365; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      if (currentDate > new Date()) {
        break;
      }

      const dayOfWeek = currentDate.getDay();
      let sessions: SessionToSave[] = [];

      if (dayOfWeek === 3 || dayOfWeek === 6) {
        // Mercredi ou Samedi
        sessions = sessions.concat(
          createSessions(currentDate, "morning", routes, boats, rowers)
        );
        sessions = sessions.concat(
          createSessions(currentDate, "afternoon", routes, boats, rowers)
        );
      } else if (dayOfWeek === 0) {
        sessions = sessions.concat(
          createSessions(currentDate, "day", routes, boats, rowers)
        );
      } else {
        sessions = sessions.concat(
          createSessions(currentDate, "evening", routes, boats, rowers)
        );
      }

      data.push(...sessions);
    }

    const batchs = batch(data, 12);

    for (const batch of batchs) {
      await sessionDatabaseRepository.saveSessions(batch);
    }
  };
};

function batch<T>(data: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < data.length; i += size) {
    batches.push(data.slice(i, i + size));
  }

  return batches;
}

function createSessions(
  date: Date,
  timeOfDay: "morning" | "afternoon" | "evening" | "day",
  routes: { id: string; name: string }[],
  boats: Boat[],
  rowers: { id: string; name: string }[]
): SessionToSave[] {
  const nbOfBoats = boats.length;

  let percentage = 0.3;

  if (timeOfDay === "morning" || timeOfDay === "afternoon") {
    percentage = 0.5;
  }

  const nbOfSessions = Math.floor(nbOfBoats * percentage);

  const sessions: SessionToSave[] = [];

  for (let i = 0; i < nbOfSessions; i++) {
    sessions.push(createSession(date, timeOfDay, routes, boats, rowers));
  }

  return sessions;
}

function getSeason(date: Date): "summer" | "winter" | "neutral" {
  const month = date.getMonth();
  // Summer season is from May to July (months 4-6)
  if (month >= 4 && month <= 6) return "summer";
  // Neutral season is from August to November (months 7-10)
  if (month >= 7 && month <= 10) return "neutral";
  // Winter season is from December to April (months 11-3)
  return "winter";
}

function getSeasonalBoat(boats: Boat[], date: Date): Boat {
  const season = getSeason(date);
  const filteredBoats = boats.filter((boat) => {
    const nbRowers = getBoatNumberOfRowers(boat.type);
    if (!nbRowers) return false;

    if (season === "summer") {
      // In summer, prefer 4+ rower boats (90% chance)
      return Math.random() < 0.9 ? nbRowers >= 4 : nbRowers < 4;
    } else if (season === "winter") {
      // In winter, prefer 1-2 rower boats (90% chance)
      return Math.random() < 0.9 ? nbRowers <= 2 : nbRowers > 2;
    } else {
      // In neutral season (August-November), no preference
      return true;
    }
  });

  // If no boats match the criteria, fall back to random selection
  return filteredBoats.length > 0
    ? filteredBoats[Math.floor(Math.random() * filteredBoats.length)]
    : boats[Math.floor(Math.random() * boats.length)];
}

function createSession(
  date: Date,
  timeOfDay: "morning" | "afternoon" | "evening" | "day",
  routes: { id: string; name: string }[],
  boats: Boat[],
  rowers: { id: string; name: string }[]
): SessionToSave {
  const hasComment = Math.random() < 0.4;
  const hasAccident = Math.random() < 0.1;

  const startDateTime = new Date(date);
  if (timeOfDay === "morning") {
    startDateTime.setHours(8 + Math.random() * 4);
  } else if (timeOfDay === "afternoon") {
    startDateTime.setHours(12 + Math.random() * 6);
  } else if (timeOfDay === "day") {
    startDateTime.setHours(8 + Math.random() * 14);
  } else if (timeOfDay === "evening") {
    startDateTime.setHours(16 + Math.random() * 6);
  }

  const boat = getSeasonalBoat(boats, date);
  const route = routes[Math.floor(Math.random() * routes.length)];

  const nbOfRowers = getBoatNumberOfRowers(boat.type);

  const selectedRowers = rowers
    .sort(() => 0.5 - Math.random())
    .slice(0, nbOfRowers);

  const sessionCreated = {
    id: generateSessionId(),
    boatId: boat.id,
    startDateTime: startDateTime.toISOString(),
    estimatedEndDateTime: getEndDateTime(startDateTime).toISOString(),
    routeId: route.id,
    endDateTime: getEndDateTime(startDateTime).toISOString(),
    incidentId: hasAccident ? generateIncidenId() : "",
    comment: hasComment ? "Commentaire aléatoire" : "",
    rowerIds: selectedRowers.map((rower) => rower.id),
  };

  return sessionCreated;
}

function getEndDateTime(startDateTime: Date): Date {
  const duration = 50 + Math.random() * 100;
  return new Date(startDateTime.getTime() + duration * 60000);
}
