import { FirestartrGithubOrgWebhookSpecWebhookContentType } from '../../../imports/firestartr.dev';
import { IOrgWebhookClaim } from '../base/orgWebhook';

export interface IGithubOrgWebhookClaim extends IOrgWebhookClaim {
  providers: {
    github: {
      name: string;
      orgName: string;
      webhook: {
        url: string;
        contentType: FirestartrGithubOrgWebhookSpecWebhookContentType;
        secretRef: string;
        active?: boolean;
        events: string[];
      };
    };
  };
}
