// One CSV encoding for every export. Cells are always quoted with quotes doubled. A cell
// starting with = + - @ tab or CR runs as a formula in Excel and Sheets, so it gets a
// leading ' (OWASP CSV injection): a change titled =HYPERLINK(...) stays text.
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value)
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",")
}
