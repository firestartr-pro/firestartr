import MemberGithubDecanter from './github_member';
import { ICollection, applyCollectionMixins } from '../collections';
import { CollectionFilter } from '../filters';
import { GithubDecanter } from './base';

class MemberCollectionGithubDecanter extends GithubDecanter {
  static collectionKind = 'gh-members';

  async collection(filters: CollectionFilter[] = []) {
    if (
      this.IS_SKIP_SET(filters, MemberCollectionGithubDecanter.collectionKind)
    )
      return [];

    const memberList = await this.github.org.getUserList(this.org);

    const memberMaps: any = {};

    memberList.forEach((member: any) => {
      memberMaps[member.login] = member;
    });

    const members: MemberGithubDecanter[] = [];

    const filteredMembers = await this.filter(
      MemberCollectionGithubDecanter.collectionKind,

      filters,

      memberList.map((member: any) => member.login),
    );

    for (const member of filteredMembers) {
      members.push(
        new MemberGithubDecanter(
          { memberDetails: memberMaps[member] },
          this.org,
        ),
      );
    }

    return members;
  }
}

interface MemberCollectionGithubDecanter extends ICollection {}

applyCollectionMixins(MemberCollectionGithubDecanter);

export default MemberCollectionGithubDecanter;
