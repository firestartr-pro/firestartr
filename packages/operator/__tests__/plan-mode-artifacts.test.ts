import { renderPlanMarkdown } from '../src/plan-mode/artifacts';

function planned(text: string) {
  return renderPlanMarkdown({
    kind: 'FirestartrGithubRepository',
    name: 'repo',
    namespace: 'default',
    operation: 'UPDATED',
    policy: 'none',
    plannedAt: '2026-01-01T00:00:00Z',
    lock: 'none',
    result: {
      status: 'PLANNED',
      counts: { add: 1, change: 0, destroy: 0 },
      text,
      json: {},
    },
  } as any);
}

describe('Plan artifact Markdown', () => {
  it('keeps the plan text literal inside a code fence', () => {
    const text =
      '  # github_repository.this will be created\n  + resource "x" {}\n';

    expect(planned(text)).toContain(
      `## Plan\n\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`,
    );
  });

  it('uses a fence longer than any backtick run in the plan text', () => {
    const text = '+ description = "```yaml\\n````"';

    expect(planned(text)).toContain(`\`\`\`\`\`text\n${text}\n\`\`\`\`\`\n`);
  });
});
