export function transformRepoName(repoName: string): string {
  // Convert to lowercase
  let transformedName = repoName.toLowerCase();

  const specialCharsRegex = /[._]/g;

  if (specialCharsRegex.test(transformedName)) {
    transformedName = transformedName.replace(/[._]/g, '');
    // we add a random 2 letter suffix
    return (
      transformedName + '-imp-' + Math.random().toString(36).substring(2, 4)
    );
  } else {
    return transformedName;
  }
}
