/**
 * The homepage's instant move estimate (from-price incl. MVA): a base per
 * move type plus 12 kr per driving km. Shared by the moving page's booking
 * widget and the platform front page's service form, so both show the same
 * figure; the booking flow then prices the job in full.
 */
export const MOVE_BASE: Record<string, number> = { 'single-item': 850, student: 1150, apartment: 1500, house: 2400, office: 3200 };

export function estimateMovePrice(moveType: string, distanceKm: number | null | undefined): number {
  return Math.round((MOVE_BASE[moveType] ?? MOVE_BASE.apartment) + (distanceKm ?? 0) * 12);
}
