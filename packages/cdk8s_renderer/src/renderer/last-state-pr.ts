import common from 'catalog_common';
import * as fs from 'fs';

export async function addLastStateAndLastClaimAnnotations(
  filePath: string,
  lastStatePRLink: string,
  lastClaimPRLink: string,
) {
  // Iterate over the source folder and get the list of Terraform workspaces

  const workspace: any = common.io.fromYaml(fs.readFileSync(filePath, 'utf-8'));

  const stateLinkAsArray: string[] = lastStatePRLink.split('/');
  const stateAnnotationValue = `${stateLinkAsArray[3]}/${stateLinkAsArray[4]}#${stateLinkAsArray[6]}`;

  const claimLinkAsArray: string[] = lastClaimPRLink.split('/');
  const claimAnnotationValue = `${claimLinkAsArray[3]}/${claimLinkAsArray[4]}#${claimLinkAsArray[6]}`;

  workspace.metadata.annotations = {
    ...workspace.metadata.annotations,
    [common.generic.getFirestartrAnnotation('last-state-pr')]:
      stateAnnotationValue,
    [common.generic.getFirestartrAnnotation('last-claim-pr')]:
      claimAnnotationValue,
  };

  fs.writeFileSync(
    filePath,
    common.io.toYaml({ ...workspace }, { quotingType: '"', lineWidth: -1 }),
  );
}
