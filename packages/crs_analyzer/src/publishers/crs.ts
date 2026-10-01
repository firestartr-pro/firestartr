import { CrsAnalyzer } from '../analyzers/crs-analyzer';
import { Context } from '../context';
import { GithubClient } from '../github-client';
import { Cr } from '../models/cr';
import { Publisher } from './base';
import { parseLog } from '../helpers/log-parser';

export class CrsPublisher extends Publisher {
  githubCli: GithubClient;

  analyzer: CrsAnalyzer;

  context: Context;

  output = '';

  constructor(
    analyzer: CrsAnalyzer,
    githubCli: GithubClient,
    context: Context,
  ) {
    super();
    this.context = context;
    this.analyzer = analyzer;
    this.githubCli = githubCli;
  }

  async publish() {
    const driftIssues = await this.filterIssuesBy('drift');
    const errorIssues = await this.filterIssuesBy('error');

    for (const wp of this.analyzer.drifted) {
      await this.publishDrift(wp);
    }

    for (const wp of this.analyzer.failed) {
      await this.publishError(wp);
    }

    await this.closeOldDriftIssues(driftIssues);

    await this.closeOldErrorIssues(errorIssues);
  }

  async closeOldErrorIssues(errorIssues: any) {
    for (const issue of errorIssues || []) {
      if (
        !this.analyzer.failed.find(
          (wp) =>
            issue.title.includes(wp.claimName) && issue.title.includes('error'),
        )
      ) {
        await this.githubCli.closeIssue(
          this.context.githubOwner,
          this.context.githubRepo,
          issue.number,
        );

        this.writeLnOutput(
          `✅ No errors detected on issue ${issue.title}. Issue has been closed.`,
        );
      }
    }
  }

  async closeOldDriftIssues(driftIssues: any) {
    for (const issue of driftIssues || []) {
      if (
        !this.analyzer.drifted.find(
          (cr) =>
            issue.title.includes(cr.claimName) && issue.title.includes('drift'),
        )
      ) {
        await this.githubCli.closeIssue(
          this.context.githubOwner,
          this.context.githubRepo,
          issue.number,
        );

        this.writeLnOutput(
          `✅ No drift detected on issue ${issue.title}. Issue has been closed.`,
        );
      }
    }
  }

  async publishError(cr: Cr) {
    const body = this.buildErrorsBody(cr);

    const resp = await this.githubCli.upsertIssue(
      this.context.githubOwner,
      this.context.githubRepo,
      `Claim '${cr.claimName}' has an error`,
      body,
      [cr.claimKind, 'error'],
    );

    this.writeLnOutput(
      `❌ Error detected for ${cr.claimKind}: ${cr.claimName}. Issue has been created or updated: ${resp.data.html_url}`,
    );

    return resp;
  }

  async publishDrift(cr: Cr) {
    const body = this.buildDriftBody(cr);

    const resp = await this.githubCli.upsertIssue(
      this.context.githubOwner,
      this.context.githubRepo,
      `Claim '${cr.claimName}' has a drift`,
      body,
      [cr.claimKind, 'drift'],
    );

    this.writeLnOutput(
      `⚠️ Drift detected for ${cr.claimKind}: ${cr.claimName}. Issue has been created or updated: ${resp.data.html_url}`,
    );

    return resp;
  }

  buildErrorsBody(cr: Cr) {
    return `
The claim '${cr.claimName}' with kind: ${cr.claimKind} has an error.

${this.buildErrorForWs(cr)}
`;
  }

  buildErrorForWs(ws: Cr) {
    return `<details id=error>
  <summary>ERROR LOG</summary>

${parseLog(ws.errorMessage)}
</details>`;
  }

  buildDriftBody(wp: Cr) {
    return `
The claim '${wp.claimName}' with kind: ${wp.claimKind} has a drift.

${this.buildDriftForWs(wp)}
`;
  }

  buildDriftForWs(ws: Cr) {
    return `<details id=drift>
  <summary>DRIFT</summary>

${parseLog(ws.driftMessage)}
</details>`;
  }

  writeLnOutput(line: string) {
    this.output += line + '\n';
  }

  filterIssuesBy(type: 'error' | 'drift') {
    return this.githubCli.listIssues(
      this.context.githubOwner,
      this.context.githubRepo,
      `${type}`,
      [type],
    );
  }
}
