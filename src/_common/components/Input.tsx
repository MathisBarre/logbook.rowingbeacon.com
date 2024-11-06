import * as React from "react";
import { cn } from "../utils/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, disabled, onClick, ...props }, ref) => {
    return (
      <input
        disabled={disabled}
        type={type}
        className={cn("input flex w-full mt-1", className)}
        ref={ref}
        onClick={onClick}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
