import GroupGithubDecanter from './github_group';
import { ICollection, applyCollectionMixins } from '../collections';
import { CollectionFilter } from '../filters';
import { GithubDecanter } from './base';

class GroupCollectionGithubDecanter extends GithubDecanter {
  static collectionKind = 'gh-group';

  async collection(filters: CollectionFilter[] = []) {
    if (this.IS_SKIP_SET(filters, GroupCollectionGithubDecanter.collectionKind))
      return [];

    const teamList = await this.github.org.getTeamList(this.org);

    const groups: GroupGithubDecanter[] = [];

    const teamMaps: any = {};

    teamList.forEach((team: any) => {
      teamMaps[team.slug] = team;
    });

    const filteredGroups = await this.filter(
      GroupCollectionGithubDecanter.collectionKind,
      filters,
      teamList.map((team: any) => team.slug),
    );

    for (const team of filteredGroups) {
      groups.push(
        new GroupGithubDecanter(
          { groupDetails: teamMaps[team] },

          this.org,
        ),
      );
    }
    return groups;
  }
}

interface GroupCollectionGithubDecanter extends ICollection {}

applyCollectionMixins(GroupCollectionGithubDecanter);

export default GroupCollectionGithubDecanter;
