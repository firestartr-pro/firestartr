function formatLog(log: string) {
  log = log.split('\\n').join('\n');

  return `\`\`\`shell
${log}
\`\`\``;
}

function parseJSON(jsonOutputStr: string) {
  let issueBody = '```json\n';

  jsonOutputStr.split('\n').forEach((output) => {
    if (output) {
      const jsonStr = JSON.stringify(JSON.parse(output), null, 2);
      issueBody = issueBody + jsonStr + '\n';
    }
  });

  issueBody += '```';
  return issueBody;
}

export function parseLog(str: string) {
  str = sanitize(str);

  try {
    return parseJSON(str);
  } catch (e) {
    return formatLog(str);
  }
}

function sanitize(str: string) {
  str = str.trim();

  str = str.slice(-63000);

  str = str[0] === '"' ? str.slice(1) : str;

  str = str[str.length - 1] === '"' ? str.slice(0, str.length - 1) : str;

  return str;
}
