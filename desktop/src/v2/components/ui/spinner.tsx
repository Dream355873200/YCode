import * as React from "react";
import { LoaderIcon } from "lucide-react";

import { cn } from "../lib/utils.js";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderIcon
      role="status"
      aria-label="加载中"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
