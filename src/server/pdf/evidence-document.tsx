// src/server/pdf/evidence-document.tsx
// Server-only @react-pdf document. Rendered to a buffer in the evidence.pdf route.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { Prisma } from "@prisma/client"

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
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  confidential: { fontSize: 7, color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 6 },
  meta: { fontSize: 8, color: "#6b7280", marginBottom: 10 },
  flags: { flexDirection: "row", gap: 6, marginBottom: 8 },
  flag: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#b91c1c", border: "1px solid #b91c1c", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  section: { marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 6 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4, color: "#111827" },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 110, color: "#6b7280" },
  value: { flex: 1 },
  para: { marginBottom: 4 },
  item: { marginBottom: 3, paddingBottom: 3, borderBottom: "0.5px solid #f3f4f6" },
  muted: { color: "#9ca3af", fontStyle: "italic" },
})

function fmt(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—"
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
      <Text style={{ fontFamily: "Helvetica-Bold" }}>{title}</Text>
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
          <Field label="Status" value={c.status} />
          <Field label="Risk" value={c.riskLevel} />
          <Field label="Category" value={c.category} />
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
                {a.filename} · {a.kind} · {a.uploadedBy.name ?? a.uploadedBy.email} · {fmt(a.uploadedAt)}
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
                  {a.approver.name ?? a.approver.email} · {a.decision}
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
            <Field label="Outcome" value={c.pir.outcome} />
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
              {fmt(e.at)} · {e.actor.name ?? e.actor.email} · {e.action}
              {e.fromStatus || e.toStatus ? ` (${e.fromStatus ?? "—"} → ${e.toStatus ?? "—"})` : ""}
              {e.note ? ` · ${e.note}` : ""}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  )
}
