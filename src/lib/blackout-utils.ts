// src/lib/blackout-utils.ts
export type BlackoutRecord = { id: string; opcoId: string | null; startsAt: Date; endsAt: Date }

export function isInBlackout(blackouts: BlackoutRecord[], date: Date): boolean {
  return blackouts.some((b) => date >= b.startsAt && date <= b.endsAt)
}
