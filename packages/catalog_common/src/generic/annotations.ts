// All annotations made by us will start with this prefix
const FIRESTARTR_ANNOTATION_PREFIX = 'firestartr.dev';

/*
 * Returns an annotation created by the following concatenation:
 *
 * FIRESTARTR_ANNOTATION_PREFIX + "/" + suffix
 *
 */
export function getFirestartrAnnotation(suffix: string): string {
  return `${FIRESTARTR_ANNOTATION_PREFIX}/${suffix}`;
}

/*
 * Gets the owner, repository and PR number from a `last-claim-pr` or
 * `last-state-pr` Firestartr CR annotation value (which follows the
 * `owner/repo#prNumber` pattern) and returns their values in an object.
 *
 * Inputs:
 * - annotationValue: a string, formatted as `owner/repo#prNumber`
 *
 * Returns: an object, with three properties: `owner`, `repo` and `pr_number`
 *
 */
export function getOwnerRepoPrNumberFromAnnotationValue(
  annotationValue: string,
) {
  const splittedValue: string[] = annotationValue.split('/');

  if (splittedValue.length === 2) {
    const owner: string = splittedValue[0];
    const repoAndPrNumberSplit: string[] = splittedValue[1].split('#');

    if (repoAndPrNumberSplit.length === 2) {
      const repo: string = repoAndPrNumberSplit[0];
      const prNumber = Number(repoAndPrNumberSplit[1]);

      return { owner, repo, prNumber };
    }
  }

  // If the strings don't split correctly, an error is thrown
  throw new Error(`Incorrect format for annotation value: ${annotationValue}`);
}

/*
 * Returns the actual pull request URL from a `last-claim-pr` or
 * `last-state-pr` Firestartr CR annotation value (which follows the
 * `owner/repo#prNumber` pattern)
 *
 * Inputs:
 * - annotationValue: a string, formatted as `owner/repo#prNumber`
 *
 * Returns: a string, "https://www.github.com/{owner}/{repo}/pull/{prNumber}"
 *
 */
export function getPrLinkFromAnnotationValue(annotationValue: string) {
  const { owner, repo, prNumber } =
    getOwnerRepoPrNumberFromAnnotationValue(annotationValue);

  return (
    'https://www.github.com/' +
    owner +
    '/' +
    repo +
    '/pull/' +
    prNumber.toString()
  );
}
