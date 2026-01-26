import * as React from "react"
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){
  return (
    <textarea
      {...props}
      className={`min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground ${props.className||''}`}
    />
  )
}
