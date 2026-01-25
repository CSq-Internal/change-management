import * as React from "react"
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>){ return <input {...props} className={`h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm ${props.className||''}`} /> }
