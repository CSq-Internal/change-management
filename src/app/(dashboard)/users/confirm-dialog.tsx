"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
