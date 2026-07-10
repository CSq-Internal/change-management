"use client"

import { useRef, useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MAX_FILE_BYTES, ACCEPT_EXTENSIONS } from "@/lib/upload-constraints"
import { isGoogleWorkspaceUrl } from "@/lib/google-links"
import type { AttachmentKind } from "@prisma/client"

interface Props {
  kind: AttachmentKind
  label: string
  /** Whether this document is mandatory for submission (drives the required asterisk). */
  required?: boolean
  hasSummary?: boolean
  summaryValue?: string
  summaryPlaceholder?: string
  onSummaryChange?: (value: string) => void
  /** Filename of a document already uploaded for this slot (edit mode). */
  existingFilename?: string
  /** URL of a Google Doc already linked for this slot (edit mode). */
  existingLink?: string
  /** A file chosen this session but not yet uploaded. */
  stagedFile?: File | null
  /** A link entered this session but not yet saved. */
  stagedLink?: string | null
  onFileChange: (file: File | null) => void
  onLinkChange?: (url: string | null) => void
}

function isAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ACCEPT_EXTENSIONS.split(",").some((ext) => lower.endsWith(ext))
}

export default function DocumentSection({
  label,
  required = true,
  hasSummary = true,
  summaryValue = "",
  summaryPlaceholder,
  onSummaryChange,
  existingFilename,
  existingLink,
  stagedFile,
  stagedLink,
  onFileChange,
  onLinkChange,
}: Props) {
  const { language } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState<boolean>(Boolean(stagedLink || existingLink))
  const [linkValue, setLinkValue] = useState<string>(stagedLink ?? existingLink ?? "")
  const [linkError, setLinkError] = useState<string | null>(null)

  function handleSelect(file: File | null) {
    if (!file) {
      setError(null)
      onFileChange(null)
      return
    }
    if (!isAcceptedExtension(file.name)) {
      setError(t(language, "requests.uploadBadType"))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t(language, "requests.uploadTooLarge"))
      return
    }
    setError(null)
    onFileChange(file)
  }

  function handleLink(value: string) {
    setLinkValue(value)
    if (!value.trim()) {
      setLinkError(null)
      onLinkChange?.(null)
      return
    }
    if (!isGoogleWorkspaceUrl(value)) {
      setLinkError(t(language, "requests.linkBadUrl"))
      onLinkChange?.(null)
      return
    }
    setLinkError(null)
    onLinkChange?.(value)
  }

  function switchToFile() {
    setLinkMode(false)
    setLinkError(null)
    onLinkChange?.(null)
  }

  function switchToLink() {
    setLinkMode(true)
    setError(null)
    onFileChange(null)
    handleLink(linkValue)
  }

  const currentName = stagedFile?.name ?? existingFilename
  const isStaged = Boolean(stagedFile)

  return (
    <div className="rounded-lg border border-border/80 bg-card/95 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {label}{" "}
        {required ? (
          <span className="text-rose-600">*</span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">{t(language, "requests.optional")}</span>
        )}
      </div>

      {hasSummary && (
        <Textarea
          placeholder={summaryPlaceholder ?? t(language, "requests.summaryOptional")}
          value={summaryValue}
          onChange={(e) => onSummaryChange?.(e.target.value)}
        />
      )}

      <div className="flex gap-1 text-xs">
        <Button type="button" variant={linkMode ? "outline" : "default"} onClick={switchToFile}>
          {t(language, "requests.docSourceFile")}
        </Button>
        <Button type="button" variant={linkMode ? "default" : "outline"} onClick={switchToLink}>
          {t(language, "requests.docSourceLink")}
        </Button>
      </div>

      {linkMode ? (
        <div className="space-y-1">
          <Input
            type="url"
            placeholder={t(language, "requests.linkPlaceholder")}
            value={linkValue}
            onChange={(e) => handleLink(e.target.value)}
          />
          {linkError && <p className="text-xs text-rose-600">{linkError}</p>}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_EXTENSIONS}
            className="hidden"
            onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              {currentName ? t(language, "requests.uploadReplace") : t(language, "requests.chooseFile")}
            </Button>
            {currentName ? (
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{currentName}</span>
                {isStaged
                  ? ` — ${t(language, "requests.uploadPending")}`
                  : ` — ${t(language, "requests.uploadCurrent")}`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t(language, "requests.uploadHint")}</span>
            )}
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </>
      )}
    </div>
  )
}
