import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "textarea textarea-sm field-sizing-content min-h-16 w-full",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
