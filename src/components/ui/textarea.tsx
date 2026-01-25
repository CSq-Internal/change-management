import * as React from "react"
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){ return <textarea {...props} className={`min-h-[100px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm ${props.className||''}`} /> }
