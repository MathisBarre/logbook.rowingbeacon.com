export interface SessionToStart {
  routeId: string | null;
  boatId: string;
  rowersId: string[];
  startDatetime: Date;
  estimatedEndDatetime?: Date | undefined;
  comment: string;
}

export const isInvalidStartSessionDate = (payload: SessionToStart) => {
  if (!payload.estimatedEndDatetime) {
    return false;
  }

  return payload.startDatetime > payload.estimatedEndDatetime;
};
