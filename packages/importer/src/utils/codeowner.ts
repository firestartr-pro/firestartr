export function extractFromCodeOwners(codeOwnersContent: string) {
  if (!codeOwnersContent) {
    return [];
  }

  return codeOwnersContent.split(/\r?\n/).flatMap((line) => {
    const trimmedLine = line.trim();

    // skip blank lines and full-line comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return [];
    }

    // strip inline comments before parsing owners
    const lineWithoutInlineComment = line.replace(/\s*#.*$/, '').trim();

    if (!lineWithoutInlineComment) {
      return [];
    }

    // CODEOWNERS format: <pattern> <owner1> [<owner2> ...]
    // first field is the path pattern; owners start from the second field
    const parts = lineWithoutInlineComment.split(/\s+/);

    if (parts.length < 2) {
      return [];
    }

    return parts
      .slice(1)
      .filter((part) => part.startsWith('@'))
      .map((owner) => ({
        full: owner, // e.g. "@myorg/backend-team"
        isTeam: owner.includes('/'), // true for teams, false for users
        name: owner,
      }));
  });
}
