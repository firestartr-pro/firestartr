import * as fs from 'fs';

export function planLoader(planPath: string): Promise<TFPlan> {
  return new Promise((ok: Function, ko: Function) => {
    fs.readFile(planPath, 'utf-8', (err, data) => {
      if (err) {
        return ko(`loading TF Plan: ${err}`);
      } else {
        ok(
          new TFPlan().load(
            data
              .split(/\n/)
              .filter((part: string) => part !== '')
              .map((part: string) => JSON.parse(part)),
          ),
        );
      }
    });
  });
}

export function planGet(planData: string): TFPlan {
  return new TFPlan().load(
    planData
      .split('\n')
      .filter((line: string) => line !== '')
      .map((part: string) => JSON.parse(part)),
  );
}

class TFPlan {
  items: TFPlanItem[] = [];

  constructor() {}

  load(parts: any[]) {
    parts.forEach((part: any) => {
      this.items.push(TFPlanItem.load(part));
    });

    return this;
  }

  get summary() {
    return this.items.find(
      (item: TFPlanItem) => item.type === 'change_summary',
    );
  }

  get version() {
    return this.items.find((item: TFPlanItem) => item.type === 'version');
  }

  get changes() {
    return this.items.filter(
      (item: TFPlanItem) => item.type === 'planned_change',
    );
  }

  get detailedBriefing() {
    const items: TFPlanItemPlannedChange[] = this.items.filter(
      (item: TFPlanItem) => item instanceof TFPlanItemPlannedChange === true,
    );

    const actions: any = {};

    items.forEach((item: TFPlanItemPlannedChange) => {
      const change = item.info();

      actions[change['action']] = actions[change['action']] || [];

      actions[change['action']].push(change['resource']['addr']);
    });

    return actions;
  }
}

abstract class TFPlanItem {
  type = '';

  data: any = null;

  static load(part: any): TFPlanItem {
    switch (part.type) {
      case 'change_summary':
        return new TFPlanItemSummary(part);

      case 'version':
        return new TFPlanItemVersion(part);

      case 'planned_change':
        return new TFPlanItemPlannedChange(part);

      default:
        return new TFPlanItemPart(part);
    }
  }

  constructor(data: any) {
    this.type = data.type;

    this.data = data;
  }

  abstract info(): any;

  toString(): string {
    return this.data['@message'];
  }
}

class TFPlanItemPlannedChange extends TFPlanItem {
  info(): any {
    return this.data['change'];
  }
}

class TFPlanItemSummary extends TFPlanItem {
  info() {
    return this.data.changes;
  }

  hasChanges() {
    return (
      this.data.changes.add > 0 ||
      this.data.changes.change > 0 ||
      this.data.changes.remove > 0 ||
      this.data.changes.import > 0
    );
  }
}

class TFPlanItemPart extends TFPlanItem {
  info() {
    return 'UNKNOWN';
  }
}

class TFPlanItemVersion extends TFPlanItem {
  info() {
    return this.data['@message'];
  }
}
