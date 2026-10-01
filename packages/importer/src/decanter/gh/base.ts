import { InitializerClaimRef } from 'cdk8s_renderer';
import Decanter from '../base';

export abstract class GithubDecanter extends Decanter {
  org: string;

  constructor(data: any, org: string) {
    super(data);

    this.org = org;
  }

  __adaptClaimRef() {
    return new InitializerClaimRef();
  }
}
