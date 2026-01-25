"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function Approvals(){
  const { changes, update } = useStore()
  const pending = changes.filter(c => c.status === 'pending')
  return (
    <div className="grid gap-3">
      {pending.map(c => (
        <Card key={c.id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{c.title}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{c.description}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={()=>update(c.id,{ status:'approved' })} variant="default">Approve</Button>
              <Button onClick={()=>update(c.id,{ status:'rejected' })} variant="destructive">Reject</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {pending.length===0 && <p className="text-sm text-slate-500">No pending approvals.</p>}
    </div>
  )
}
