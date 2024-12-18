import { cn } from "../utils/utils";
import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../store/adminEditMode.system";
import { AdminPage } from "../store/navigation.store";

const PageButton = ({
  page,
  currentPage,
  setPage,
  icon,
  label,
}: {
  page: AdminPage;
  currentPage: AdminPage;
  setPage: (page: AdminPage) => void;
  icon: React.ReactNode;
  label: string;
}) => {
  const adminEditSystem = useAdminEditModeSystem();

  const handleClick = async () => {
    if (page === "parameters" && adminEditSystem) {
      if (adminEditSystem.allowAdminActions(await askForAdminPassword())) {
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
        "text-sm font-medium text-steel-blue-800 hover:bg-gray-200 flex-1 flex items-center justify-center gap-2 shadow-md rounded bg-white border",
        currentPage === page && " border-steel-blue-900 bg-gray-100"
      )}
    >
      {icon}
      {label}
    </button>
  );
};

export default PageButton;
