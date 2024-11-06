export interface SessionToStart {
  routeId: string;
  boatId: string;
  rowersId: string[];
  startDatetime: Date;
  estimatedEndDatetime: Date;
  comment: string;
}

export const isInvalidStartSessionDate = (payload: SessionToStart) => {
  return payload.startDatetime > payload.estimatedEndDatetime;
};
