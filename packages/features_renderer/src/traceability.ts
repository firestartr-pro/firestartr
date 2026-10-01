const IS_WORKFLOW_REGEXP = new RegExp(/\.github\/workflows\/.+\.(yaml|yml)$/);

import path from 'path';
import fs from 'fs';

export function addTraceability(context: any, src: string, content: string) {
  if (IS_WORKFLOW_REGEXP.test(src)) {
    return addTraceabilityStamp(context, content);
  } else {
    return content;
  }
}

function addTraceabilityStamp(context: any, content: string) {
  const traceability = context.traceability || {};

  const stampLines: string[] = [
    '---',
    `# FEATURE_NAME: ${traceability.name}`,
    `# FEATURE_VERSION: ${traceability.version}`,
    `# FEATURE_URL: ${traceability.url}`,
  ];

  if (traceability.sha) {
    stampLines.push(`# FEATURE_GIT_SHA: "${traceability.sha}"`);
  }

  if (Array.isArray(traceability.tags) && traceability.tags.length > 0) {
    stampLines.push(`# FEATURE_GIT_TAGS: ${JSON.stringify(traceability.tags)}`);
  }

  const stamp = `${stampLines.join('\n')}\n\n`;

  const output = [];
  let replaced = false;

  for (const line of content.split(/\n/)) {
    if (line === '---' && !replaced) {
      output.push(stamp);

      replaced = true;
    } else {
      output.push(line);
    }
  }

  if (replaced) {
    return output.join('\n');
  } else {
    return stamp + content;
  }
}
