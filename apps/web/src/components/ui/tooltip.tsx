import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
  /** When true, the tooltip is rendered into the DOM only when needed. */
  disabled?: boolean;
}

const Side = {
  top: "top" as const,
  right: "right" as const,
  bottom: "bottom" as const,
  left: "left" as const,
};

export function Tooltip({
  label,
  children,
  side = "right",
  align = "center",
  sideOffset = 8,
  className,
  disabled = false,
}: TooltipProps) {
  if (disabled || !label) {
    return <>{children}</>;
  }
  return (
    <TooltipPrimitive.Provider delayDuration={150} skipDelayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            align={align}
            className={cn(
              "sidebar-tooltip",
              `sidebar-tooltip--${Side[side]}`,
              className,
            )}
            side={side}
            sideOffset={sideOffset}
          >
            {label}
            <TooltipPrimitive.Arrow className="sidebar-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
