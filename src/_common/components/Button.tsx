import { AriaRole } from "react";
import { cn } from "../utils/utils";

interface ButtonProps {
  children: React.ReactNode;
  className?: string;
  type: "button" | "submit" | "reset" | undefined;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "outlined" | "text";
  color?: "primary" | "danger";
  role?: AriaRole;
}

const Button = ({
  children,
  className,
  type,
  onClick,
  disabled,
  loading,
  variant = "primary",
  color = "primary",
  role,
}: ButtonProps) => {
  // if button loading, disable it
  disabled = loading || disabled;

  const isPrimary = variant === "primary";
  const isOutlined = variant === "outlined";
  const isText = variant === "text";

  const isColorPrimary = color === "primary";
  const isColorDanger = color === "danger";

  return (
    <>
      <button
        disabled={disabled}
        onClick={onClick}
        type={type}
        className={cn([
          // primary - primary
          isColorPrimary &&
            isPrimary &&
            "bg-steel-blue-700 px-4 py-2 rounded text-white border border-steel-blue-700",
          isColorPrimary && isPrimary && !disabled && "hover:bg-steel-blue-800",
          isColorPrimary && isPrimary && loading && "dashed-transparent",

          // primary - outlined
          isColorPrimary &&
            isOutlined &&
            " bg-steel-blue-50 px-4 py-2 border border-steel-blue-200 rounded text-steel-blue-800",
          isColorPrimary &&
            isOutlined &&
            !disabled &&
            "hover:bg-steel-blue-100",
          isColorPrimary && isOutlined && loading && "dashed-primary",

          // primary - text
          isColorPrimary &&
            isText &&
            "px-4 py-2 text-steel-blue-700 hover:underline",
          // isColorPrimary &&
          //   isOutlined &&
          //   !disabled &&
          //   "hover:bg-steel-blue-100",
          // isColorPrimary && isOutlined && loading && "dashed-primary",

          // danger - primary
          isColorDanger &&
            isPrimary &&
            "bg-error-600 px-4 py-2 rounded text-white",
          isColorDanger && isPrimary && !disabled && "hover:bg-error-700",
          isColorDanger && isPrimary && loading && "dashed-transparent",

          // danger - outlined
          isColorDanger &&
            isOutlined &&
            "border border-error-600 px-4 py-2 rounded text-error-600",
          isColorDanger && isOutlined && !disabled && "hover:bg-error-200",
          isColorDanger && isOutlined && loading && "dashed-error",

          disabled && "opacity-50 cursor-not-allowed",
          className,
          "flex justify-center items-center",
        ])}
        role={role}
      >
        {children}
      </button>
    </>
  );
};

export default Button;
