import { ReactNode } from "react";

interface BoatListWrapperProps {
  search: string;
  setSearch: (search: string) => void;
  children: React.ReactNode;
  label: string;
  icon: ReactNode;
}

export const BoatListWrapper = ({
  search,
  setSearch,
  children,
  label,
  icon,
}: BoatListWrapperProps) => {
  return (
    <div className="border-r bg-white flex flex-col h-full w-full rounded overflow-hidden border-l-steel-blue-800 border-l-8">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between items-center">
        <h1 className="text-base flex items-center gap-2">
          {icon}
          {label}
        </h1>
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

      <div className="absolute left-2 top-12 w-2 h-2 z-20">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>

      {children}
    </div>
  );
};
