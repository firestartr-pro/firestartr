import github from 'github';
import { extractPrInfo } from './user-feedback-ops';

function operatorProfile() {
  return github.withProfile('operator');
}

export async function GHCheckRun(cmd: string, item: any) {
  const prInfo = extractPrInfo(item);

  if (!prInfo.prNumber) {
    throw new Error('GHCheckRun: prNumber not retrievable');
  }

  const checkRun = await operatorProfile().feedback.createCheckRun(
    prInfo.org,
    prInfo.repo,
    helperCreateCheckRunName(cmd, item),
    {
      pullNumber: Number(prInfo.prNumber),
      // check-run comments removed: redundant with native checks widget (#1985)
    },
  );

  checkRun.mdOptionsDetails({
    quotes: 'terraform',
  });

  void checkRun.update('Initiating', 'queued');

  return {
    fnData: (d: any) => {
      void checkRun.update(d.toString(), 'in_progress');
    },

    fnEnd: () => {
      void checkRun.close('OK', true);
    },

    fnOnError: (err: any) => {
      void checkRun.close('KO', false);
    },
  };
}

function helperCreateCheckRunName(cmd: string, item: any) {
  return `${item.kind} - ${cmd}`;
}
