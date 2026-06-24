import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// daisyUI 5 の `btn` ベース。バリアント/サイズは daisyUI の修飾クラスへマッピングし、
// 呼び出し側の API（variant/size）は据え置く。SVG アイコンの基本サイズだけ補助。
const buttonVariants = cva(
  "btn font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        // 既定のアウトラインは枠が base-content（濃色）で硬いので淡色に寄せる
        outline: "btn-outline border-base-300 text-base-content hover:border-base-content",
        secondary: "btn-secondary",
        ghost: "btn-ghost",
        destructive: "btn-error btn-soft",
        link: "btn-link",
      },
      size: {
        default: "btn-sm",
        xs: "btn-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "btn-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "btn-md",
        icon: "btn-square btn-sm",
        "icon-xs": "btn-square btn-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "btn-square btn-sm",
        "icon-lg": "btn-square btn-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
