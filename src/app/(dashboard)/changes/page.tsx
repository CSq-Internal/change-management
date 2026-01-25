"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function Changes(){
  const { changes, update } = useStore()
  return (
    <div className="grid gap-3">
      {changes.map(c => (
        <Card key={c.id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{c.title}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-xs text-slate-500">{c.status} • {new Date(c.updatedAt).toLocaleString()}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Button variant="outline" onClick={()=>update(c.id,{ status:'implemented' })}>Mark Implemented</Button>
              <Button variant="outline" onClick={()=>update(c.id,{ status:'verified' })}>Mark Verified</Button>
              <Button variant="outline" onClick={()=>update(c.id,{ status:'closed' })}>Close</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
