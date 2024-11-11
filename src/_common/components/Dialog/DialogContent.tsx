import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../utils/utils";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { DialogOverlay } from "./DialogOverlay";
import { DialogPortal } from "./DialogPortal";
import { DialogTitle } from "./DialogTitle";
import { DialogDescription } from "./DialogDescription";
import { DialogHeader } from "./DialogHeader";

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title?: string;
  subtitle?: string;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, title = "Title", subtitle, ...props }, ref) => (
  <DialogPortal container={document.getElementById("dialog-portal-root")}>
    <DialogOverlay />
    <DialogPrimitive.Content
      onInteractOutside={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] border bg-background overflow-hidden shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      <DialogHeader className="bg-gradient-to-r from-steel-blue-800 to-steel-blue-600 w-full px-6 py-4 flex justify-between items-center">
        <div className={cn("flex flex-col justify-center", subtitle && "my-1")}>
          <DialogTitle
            className={cn(
              "text-gray-100",
              subtitle && "mb-[0.2rem]",
              !subtitle && "my-1"
            )}
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-gray-100">
            {subtitle}
          </DialogDescription>
        </div>

        <DialogPrimitive.Close className="text-white bg-white bg-opacity-5 border border-white border-opacity-10 p-2 rounded-sm opacity-90 ring-offset-background transition-opacity hover:opacity-100 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground ">
          <XMarkIcon className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogHeader>
      <div className="p-6">{children}</div>
    </DialogPrimitive.Content>
  </DialogPortal>
));

DialogContent.displayName = DialogPrimitive.Content.displayName;
