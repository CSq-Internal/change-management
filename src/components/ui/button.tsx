import * as React from "react"
interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default'|'outline'|'destructive' }
export function Button({ className, variant='default', ...props }: Props){
  const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 transition-colors'
  const variants: Record<string,string> = {
    default: 'bg-blue-600 text-white hover:bg-blue-700',
    outline: 'border border-slate-300 hover:bg-slate-50',
    destructive: 'bg-rose-600 text-white hover:bg-rose-700'
  }
  return <button className={`${base} ${variants[variant]} ${className||''}`} {...props} />
}
