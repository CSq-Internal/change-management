"use client"

import { useState, useRef } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import type { AttachmentKind } from "@prisma/client"

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"

type Current = { id: string; filename: string }

interface Props {
  changeId: string | null
  kind: AttachmentKind
  label: string
  current?: Current
  onUploaded?: (attachment: { id: string; filename: string }) => void
}

export default function DocumentUpload({ changeId, kind, label, current, onUploaded }: Props) {
  const { language } = useStore()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Current | undefined>(current)

  async function handleFile(file: File) {
    if (!changeId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.set("kind", kind)
      form.set("file", file)
      const res = await fetch(`/api/changes/${changeId}/documents`, { method: "POST", body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Upload failed")
      }
      const att = await res.json()
      setUploaded({ id: att.id, filename: att.filename })
      onUploaded?.({ id: att.id, filename: att.filename })
      toast({ title: `${label}: ${att.filename}`, variant: "success" })
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Error", variant: "error" })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {label} <span className="text-rose-600">*</span>
      </div>
      {!changeId ? (
        <p className="text-xs text-amber-600">{t(language, "requests.uploadDraftFirst")}</p>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploaded ? t(language, "requests.uploadReplace") : t(language, "requests.uploadRequired")}
            </Button>
            {uploaded && (
              <span className="text-sm text-muted-foreground">
                {t(language, "requests.uploadCurrent")}: <span className="font-medium text-foreground">{uploaded.filename}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t(language, "requests.uploadHint")}</p>
        </>
      )}
    </div>
  )
}
