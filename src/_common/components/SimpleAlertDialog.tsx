import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./Alert";
import { AlertDialog } from "./Alert";

export const SimpleAlertDialog = ({
  title,
  description,
  isOpen,
  cancelElement,
  confirmElement,
}: {
  title: string;
  description: string;
  isOpen: boolean;
  cancelElement: React.ReactNode;
  confirmElement: React.ReactNode;
}) => {
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>{cancelElement}</AlertDialogCancel>
          <AlertDialogAction asChild>{confirmElement}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
