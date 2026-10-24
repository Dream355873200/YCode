import * as React from "react";
import { ContextMenu as ContextPrimitive } from "radix-ui";

import { cn } from "../lib/utils.js";

// 右键菜单（radix）：外观与下拉菜单一致；内容 portal 到 body 且 no-drag。

const ContextMenu = ContextPrimitive.Root;
const ContextMenuTrigger = ContextPrimitive.Trigger;

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content
        className={cn(
          "no-drag z-50 min-w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          className,
        )}
        {...props}
      />
    </ContextPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof ContextPrimitive.Item> & { tone?: "destructive" }) {
  return (
    <ContextPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-ui-base text-foreground outline-none transition-colors data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-foreground-subtle",
        tone === "destructive" && "text-destructive data-[highlighted]:bg-destructive/10 [&_svg:not([class*='text-'])]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Separator>) {
  return <ContextPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border/60", className)} {...props} />;
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger };
