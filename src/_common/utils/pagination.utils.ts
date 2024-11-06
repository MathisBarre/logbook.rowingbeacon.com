export const paginateData = <T>(
  data: T[],
  { currentPage, pageSize }: { currentPage: number; pageSize: number }
): T[] => {
  return data.slice((currentPage - 1) * pageSize, currentPage * pageSize);
};
