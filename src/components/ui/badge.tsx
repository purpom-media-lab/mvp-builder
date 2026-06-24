import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// daisyUI 5 の `badge`。バリアントは daisyUI の色/スタイル修飾へマッピング。
const badgeVariants = cva(
  // daisyUI badge は既定で折り返す（white-space:normal）が高さ固定のため、長いラベルが
  // はみ出す。従来どおり whitespace-nowrap で1行に保つ（横に伸び、親で wrap）。
  "badge badge-sm whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "badge-primary",
        secondary: "badge-secondary",
        destructive: "badge-error badge-soft",
        outline: "badge-outline",
        ghost: "badge-ghost",
        link: "badge-ghost link link-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
