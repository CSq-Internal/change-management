import * as React from "react"
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>){
  return (
    <input
      {...props}
      className={`h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground ${props.className||''}`}
    />
  )
}
