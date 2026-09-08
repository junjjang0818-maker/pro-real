/** A study subject. User-defined. `label` is the only field that ever leaves
 *  the device (for AI comment generation). */
export interface Subject {
  id: string;
  label: string;
  colorToken: string;
  /** finger count that selects this subject via gesture; 1..5 or null (button only). */
  gestureFingerCount: 1 | 2 | 3 | 4 | 5 | null;
  /** weekly target in ms — the basis for the rule-based deficit calculation. */
  weeklyTargetMs: number;
  archivedAt: number | null;
  createdAt: number;
}

export function activeSubjects(subjects: Subject[]): Subject[] {
  return subjects.filter((s) => s.archivedAt == null);
}

export function subjectByFingerCount(subjects: Subject[], count: number): Subject | undefined {
  return activeSubjects(subjects).find((s) => s.gestureFingerCount === count);
}
