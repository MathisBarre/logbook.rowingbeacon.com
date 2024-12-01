import { v4 as uuidv4 } from "uuid";
import {
  SessionDatabaseRepository,
  SessionToSave,
} from "../business/StopSession/StopSession.usecase";
import { generateIncidenId } from "../../_common/business/incident.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { fromBoatTypeToNbOfRowers } from "../../_common/business/boat.rules";
import { Boat } from "../../_common/types/boat.type";

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

    for (const session of data) {
      await sessionDatabaseRepository.saveSession(session);
    }
  };
};

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

function createSession(
  date: Date,
  timeOfDay: "morning" | "afternoon" | "evening" | "day",
  routes: { id: string; name: string }[],
  boats: Boat[],
  rowers: { id: string; name: string }[]
): SessionToSave {
  const hasComment = Math.random() < 0.4;
  const hasAccident = Math.random() < 0.1;

  let startDateTime = new Date(date);
  if (timeOfDay === "morning") {
    startDateTime.setHours(8 + Math.random() * 4);
  } else if (timeOfDay === "afternoon") {
    startDateTime.setHours(12 + Math.random() * 6);
  } else if (timeOfDay === "day") {
    startDateTime.setHours(8 + Math.random() * 14);
  } else if (timeOfDay === "evening") {
    startDateTime.setHours(16 + Math.random() * 6);
  }

  const boat = boats[Math.floor(Math.random() * boats.length)];
  const route = routes[Math.floor(Math.random() * routes.length)];

  const nbOfRowers = fromBoatTypeToNbOfRowers(boat.type);

  const selectedRowers = rowers
    .sort(() => 0.5 - Math.random())
    .slice(0, nbOfRowers);

  const sessionCreated = {
    id: uuidv4(),
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
