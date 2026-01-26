"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function Audits(){
  const { changes } = useStore()
  return (
    <Card className="border-slate-200/80 bg-white/95">
      <CardHeader><CardTitle>Audit Evidence</CardTitle></CardHeader>
      <CardContent>
        <p className="text-slate-600 text-sm">Export change records for ISO audits. (Stubbed UI)</p>
        <pre className="mt-4 bg-gray-50 p-3 rounded text-xs overflow-auto">{JSON.stringify(changes, null, 2)}</pre>
      </CardContent>
    </Card>
  )
}
