// src/server/pdf/evidence-document.tsx
// Server-only @react-pdf document. Rendered to a buffer in the evidence.pdf route.
import path from "node:path"
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer"
import type { Prisma } from "@prisma/client"
import { utcStamp } from "@/lib/dates"
import { t } from "@/lib/i18n"
import { DOC_LABEL_KEY } from "@/lib/attachment-kinds"

// Embedded Unicode font: the built-in Helvetica is not embedded and only covers WinAnsi,
// so "→", "≥" and non-Latin names came out garbled. Files are traced in next.config.ts.
const fontDir = path.join(process.cwd(), "src/server/pdf/fonts")
Font.register({
  family: "DejaVuSans",
  fonts: [
    { src: path.join(fontDir, "DejaVuSans.ttf") },
    { src: path.join(fontDir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" },
  ],
})

export type EvidenceChange = Prisma.ChangeRequestGetPayload<{
  include: {
    opco: true
    requester: true
    implementedBy: true
    approvals: { include: { approver: true } }
    auditTrail: { include: { actor: true } }
    attachments: { include: { uploadedBy: true } }
    pir: { include: { author: true } }
  }
}>

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "DejaVuSans", color: "#1f2937", lineHeight: 1.4 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  brand: { fontSize: 12, fontWeight: "bold" },
  confidential: { fontSize: 7, color: "#b91c1c", fontWeight: "bold" },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 6, marginBottom: 4 },
  meta: { fontSize: 8, color: "#6b7280", marginBottom: 10 },
  flags: { flexDirection: "row", gap: 6, marginBottom: 8 },
  flag: { alignSelf: "flex-start", lineHeight: 1, fontSize: 7, fontWeight: "bold", color: "#b91c1c", border: "1px solid #b91c1c", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  section: { marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 6 },
  sectionTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 4, color: "#111827" },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 110, color: "#6b7280" },
  value: { flex: 1 },
  para: { marginBottom: 4 },
  item: { marginBottom: 3, paddingBottom: 3, borderBottom: "0.5px solid #f3f4f6" },
  muted: { color: "#9ca3af" },
})

// English label for a stored code, falling back to the code with spaces.
function label(key: string, code: string): string {
  const v = t("en", key)
  return v === key ? code.replace(/_/g, " ") : v
}

function fmt(d: Date | null | undefined): string {
  return d ? utcStamp(d) : "—"
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

function Block({ title, text }: { title: string; text: string | null }) {
  return (
    <View style={styles.para}>
      <Text style={{ fontWeight: "bold" }}>{title}</Text>
      <Text>{text?.trim() ? text : "—"}</Text>
    </View>
  )
}

export function EvidenceDocument({ change, generatedAt }: { change: EvidenceChange; generatedAt: Date }) {
  const c = change
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>CSquared CMS · Change Evidence Package</Text>
          <Text style={styles.confidential}>INTERNAL · CONFIDENTIAL</Text>
        </View>
        <Text style={styles.meta}>Reference #{c.reference} · generated {fmt(generatedAt)}</Text>

        <Text style={styles.title}>{c.title}</Text>
        <View style={styles.flags}>
          {c.isEmergency && <Text style={styles.flag}>EMERGENCY</Text>}
          {c.expedited && <Text style={styles.flag}>EXPEDITED</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Field label="OpCo" value={c.opco.name} />
          <Field label="Status" value={label(`status.${c.status}`, c.status)} />
          <Field label="Risk" value={label(`riskLevel.${c.riskLevel}`, c.riskLevel)} />
          <Field label="Category" value={label(`requests.category.${c.category}`, c.category)} />
          <Field label="Infrastructure" value={c.infrastructureType} />
          <Field label="Requester" value={c.requester.name ?? c.requester.email} />
          <Field label="Implementer" value={c.implementedBy ? (c.implementedBy.name ?? c.implementedBy.email) : "—"} />
          <Field label="Contact" value={c.contactEmail} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dates</Text>
          <Field label="Created" value={fmt(c.createdAt)} />
          <Field label="Planned start" value={fmt(c.plannedStart)} />
          <Field label="Planned end" value={fmt(c.plannedEnd)} />
          <Field label="SLA deadline" value={fmt(c.slaDeadline)} />
          <Field label="Implemented at" value={fmt(c.implementedAt)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change detail</Text>
          <Block title="Description" text={c.description} />
          <Block title="Change reason" text={c.changeReason} />
          <Block title="Impact scope" text={c.impactScope} />
          <Block title="Implementation plan" text={c.implementationPlan} />
          <Block title="Testing plan" text={c.testingPlan} />
          <Block title="Backout plan" text={c.backoutPlan} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attachments</Text>
          {c.attachments.length === 0 ? (
            <Text style={styles.muted}>No attachments.</Text>
          ) : (
            c.attachments.map((a) => (
              <Text key={a.id} style={styles.item}>
                {a.filename} · {label(DOC_LABEL_KEY[a.kind] ?? a.kind, a.kind)} · {a.uploadedBy.name ?? a.uploadedBy.email} · {fmt(a.uploadedAt)}
              </Text>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Approvals</Text>
          {c.approvals.length === 0 ? (
            <Text style={styles.muted}>No approvals recorded.</Text>
          ) : (
            c.approvals.map((a) => (
              <View key={a.id} style={styles.item}>
                <Text>
                  {a.approver.name ?? a.approver.email} · {a.decision === "approve" ? "Approved" : a.decision === "reject" ? "Rejected" : a.decision}
                  {a.isCab ? " (CAB)" : ""} · {fmt(a.decidedAt)}
                </Text>
                {a.comment ? <Text style={styles.muted}>{a.comment}</Text> : null}
              </View>
            ))
          )}
        </View>

        {c.pir ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Post-Implementation Review</Text>
            <Field label="Outcome" value={label(`pir.outcome.${c.pir.outcome}`, c.pir.outcome)} />
            <Field label="Backout used" value={c.pir.backoutUsed ? "Yes" : "No"} />
            <Field label="Author" value={c.pir.author.name ?? c.pir.author.email} />
            <Field label="Recorded" value={fmt(c.pir.createdAt)} />
            <Block title="Summary" text={c.pir.summary} />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audit trail</Text>
          {c.auditTrail.map((e) => (
            <Text key={e.id} style={styles.item}>
              {fmt(e.at)} · {e.actor.name ?? e.actor.email} · {label(`audit.action.${e.action}`, e.action)}
              {e.fromStatus || e.toStatus
                ? ` (${e.fromStatus ? label(`status.${e.fromStatus}`, e.fromStatus) : "—"} → ${e.toStatus ? label(`status.${e.toStatus}`, e.toStatus) : "—"})`
                : ""}
              {e.note ? ` · ${e.note}` : ""}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  )
}
