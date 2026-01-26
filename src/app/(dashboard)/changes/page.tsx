"use client"
import { useStore } from "@/lib/store"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"

export default function Changes(){
  const { changes, update } = useStore()
  const { toast } = useToast()
  return (
    <div className="grid gap-4">
      {changes.map(c => (
        <Card key={c.id} className="border-slate-200/80 bg-white/95">
          <CardHeader className="pb-2"><CardTitle className="text-base">{c.title}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-xs text-slate-500">{c.status} • {new Date(c.updatedAt).toLocaleString()}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "implemented" })
                  toast({ title: "Implemented", description: "Change marked as implemented." })
                }}
              >
                Mark Implemented
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "verified" })
                  toast({ title: "Verified", description: "Change marked as verified." })
                }}
              >
                Mark Verified
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  update(c.id, { status: "closed" })
                  toast({ title: "Closed", description: "Change closed and ready for audit." })
                }}
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {changes.length === 0 && <p className="text-sm text-slate-500">No changes yet.</p>}
    </div>
  )
}
