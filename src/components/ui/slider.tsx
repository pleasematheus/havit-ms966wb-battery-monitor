import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"
import type * as React from "react"

const thumbKeys = ["start", "end"]

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabels,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { thumbLabels?: string[] }) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none select-none items-center data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {thumbKeys.slice(0, values.length).map((key, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={key}
          aria-label={thumbLabels?.[index]}
          className="block size-4 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-shadow outline-none hover:ring-4 hover:ring-primary/15 focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
