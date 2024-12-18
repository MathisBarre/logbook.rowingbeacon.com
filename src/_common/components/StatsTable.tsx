export const StatsTable = ({
  headers,
  stats,
}: {
  headers: Record<string, string>;
  stats: Record<string, string>[];
}) => {
  return (
    <div className="border rounded overflow-auto max-h-[32rem]">
      <table className="w-full">
        <thead>
          <tr>
            {Object.values(headers).map((header, index) => (
              <th
                key={index}
                className={`border border-t-0 p-1 text-left ${
                  index === 0 ? "border-l-0" : ""
                } ${
                  index === Object.values(headers).length - 1
                    ? "border-r-0"
                    : ""
                }`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.rowerId} className="group">
              {Object.keys(headers).map((key, index) => (
                <td
                  key={index}
                  className={`border p-1 group-last:border-b-0 ${
                    index === 0 ? "border-l-0" : ""
                  } ${
                    index === Object.keys(headers).length - 1
                      ? "border-r-0"
                      : ""
                  }`}
                >
                  {stat[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
