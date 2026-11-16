export type PlanChangeCounts = {
  add: number;
  change: number;
  destroy: number;
};

/**
 * Counts the resource changes of a `tofu show -json <planfile>` document the
 * same way the human plan summary does: a replacement counts as one add and
 * one destroy, and reads and no-ops are not counted.
 */
export function countPlanDocumentChanges(planDocument: any): PlanChangeCounts {
  const counts: PlanChangeCounts = { add: 0, change: 0, destroy: 0 };

  for (const resourceChange of planDocument?.resource_changes ?? []) {
    const actions: string[] = resourceChange?.change?.actions ?? [];

    if (actions.includes('create')) counts.add++;
    if (actions.includes('update')) counts.change++;
    if (actions.includes('delete')) counts.destroy++;
  }

  return counts;
}
