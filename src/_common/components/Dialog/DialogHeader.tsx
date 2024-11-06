import * as React from "react";
import { cn } from "../../utils/utils";

export const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";
