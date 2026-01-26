import * as React from "react"
interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default'|'outline'|'destructive' }
export function Button({ className, variant='default', ...props }: Props){
  const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 transition-colors'
  const variants: Record<string,string> = {
    default: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border text-foreground hover:bg-muted',
    destructive: 'bg-destructive text-destructive-foreground hover:opacity-90'
  }
  return <button className={`${base} ${variants[variant]} ${className||''}`} {...props} />
}
