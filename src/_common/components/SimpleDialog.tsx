import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { cn } from "../utils/utils";

export const SimpleDialog = ({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  className,
  modal = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  modal?: boolean;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent
        title={title}
        subtitle={subtitle}
        className={cn("bg-white", className)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};
