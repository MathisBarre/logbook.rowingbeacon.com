import { cn } from "../utils/utils";
import { useAdminEditModeSystem } from "../store/adminEditMode.system";
import { AdminPage } from "../store/navigation.store";

const PageButton = ({
  page,
  currentPage,
  setPage,
  icon,
  label,
  className,
}: {
  page: AdminPage;
  currentPage: AdminPage;
  setPage: (page: AdminPage) => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) => {
  const adminEditSystem = useAdminEditModeSystem();

  const handleClick = async () => {
    if (page === "parameters" && adminEditSystem) {
      if (await adminEditSystem.askForAdminAccess()) {
        setPage(page);
      }
    } else {
      setPage(page);
    }
  };

  return (
    <button
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onClick={handleClick}
      className={cn(
        "text-sm font-medium text-steel-blue-800 hover:bg-gray-200 flex-1 shadow-md rounded bg-white border overflow-hidden",
        currentPage === page && " border-steel-blue-900 bg-gray-100 bg-pattern",
        className
      )}
    >
      <div className="flex items-center justify-center gap-2 bg-radial-white h-full w-full">
        {icon}
        {label}
      </div>
    </button>
  );
};

export default PageButton;
