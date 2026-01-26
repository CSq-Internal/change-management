import * as React from "react"
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-border bg-card text-card-foreground ${className||''}`} {...props} />
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={`p-4 ${className||''}`} {...props} /> }
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) { return <h3 className={`text-lg font-semibold leading-none tracking-tight ${className||''}`} {...props} /> }
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`text-sm text-muted-foreground ${className||''}`} {...props} />
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={`p-4 pt-0 ${className||''}`} {...props} /> }
