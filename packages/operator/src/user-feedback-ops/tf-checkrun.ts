import github from 'github';
import log from '../logger';
import {
  extractPrInfo,
  progressCommentBaseKind,
  progressCommentText,
} from './user-feedback-ops';

function operatorProfile() {
  return github.withProfile('operator');
}

export async function TFCheckRun(cmd: string, item: any) {
  try {
    const prInfo = extractPrInfo(item);

    const checkRun = await operatorProfile().feedback.createCheckRun(
      prInfo.org,
      prInfo.repo,
      helperCreateCheckRunName(cmd, item),
      {
        pullNumber: Number(prInfo.prNumber),
        // Apply progress comment: the result publisher updates this same
        // comment in place when the operation ends (shared sticky base
        // kind keyed per resource).
        includeCheckRunComment: true,
        checkRunComment: progressCommentText(cmd, item),
        stickyCommentBaseKind: progressCommentBaseKind(cmd, item),
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

      fnOnError: (_: any) => {
        void checkRun.close('KO', false);
      },
    };
  } catch (e) {
    // log error and return empty fns
    log.warn('Error in TFCheckRun:', e);
    return {
      fnData: (_: any) => {},
      fnEnd: () => {},
      fnOnError: (_: any) => {},
    };
  }
}

function helperCreateCheckRunName(cmd: string, item: any) {
  return `${item.kind} - ${cmd}`;
}
