import common from 'catalog_common';

import log from './logger';

export const LAST_STATE_PR_ANNOTATION = 'firestartr.dev/last-state-pr';

export type PrAnnotationInfo = {
  annotationValue: string;
  owner: string;
  repo: string;
  prNumber: number;
};

export function getPrInfoFromAnnotation(
  item: any,
  annotation = LAST_STATE_PR_ANNOTATION,
): PrAnnotationInfo | null {
  const itemId = `${item?.kind ?? 'UnknownKind'}/${item?.metadata?.name ?? 'unknown'}`;
  const annotationValue = item?.metadata?.annotations?.[annotation];

  if (
    typeof annotationValue !== 'string' ||
    annotationValue.trim().length === 0
  ) {
    log.warn(
      `CR ${itemId} is missing annotation "${annotation}"; skipping GitHub feedback.`,
    );
    return null;
  }

  try {
    const { owner, repo, prNumber } =
      common.generic.getOwnerRepoPrNumberFromAnnotationValue(annotationValue);

    return {
      annotationValue,
      owner,
      repo,
      prNumber,
    };
  } catch (e: any) {
    log.warn(
      `CR ${itemId} has invalid annotation "${annotation}" with value '${annotationValue}'; skipping GitHub feedback. Error: '${e?.message ?? String(e)}'.`,
    );
    return null;
  }
}
