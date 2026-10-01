import OrgSettingsGithubDecanter from './github_org_settings';
import { ICollection, applyCollectionMixins } from '../collections';
import { CollectionFilter } from '../filters';
import { GithubDecanter } from './base';

class OrgSettingsCollectionGithubDecanter extends GithubDecanter {
  static collectionKind = 'gh-org-settings';

  async collection(filters: CollectionFilter[] = []) {
    if (
      this.IS_SKIP_SET(
        filters,
        OrgSettingsCollectionGithubDecanter.collectionKind,
      )
    ) {
      return [];
    }

    const filteredOrgs = await this.filter(
      OrgSettingsCollectionGithubDecanter.collectionKind,

      filters,

      [this.org],
    );

    return filteredOrgs.map(
      (orgName: string) => new OrgSettingsGithubDecanter({}, orgName),
    );
  }
}

interface OrgSettingsCollectionGithubDecanter extends ICollection {}

applyCollectionMixins(OrgSettingsCollectionGithubDecanter);

export default OrgSettingsCollectionGithubDecanter;
