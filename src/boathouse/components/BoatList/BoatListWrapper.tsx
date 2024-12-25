interface BoatListWrapperProps {
  search: string;
  setSearch: (search: string) => void;
  children: React.ReactNode;
  label: string;
}

export const BoatListWrapper = ({
  search,
  setSearch,
  children,
  label,
}: BoatListWrapperProps) => {
  return (
    <div className="border-r bg-white flex flex-col h-full w-full rounded overflow-hidden">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between items-center">
        <h1 className="text-base ml-2">{label}</h1>
        <div>
          <label htmlFor="boatFilter" className="font-normal sr-only">
            Rechercher :{" "}
          </label>
          <input
            onChange={(e) => setSearch(e.target.value)}
            value={search}
            type="text"
            placeholder="Rechercher un bateau..."
            className="border border-gray-400 rounded shadow-sm px-1 py-0 w-64 h-8 text-black placeholder-gray-500 opacity-90"
          />
        </div>
      </div>

      {children}
    </div>
  );
};
