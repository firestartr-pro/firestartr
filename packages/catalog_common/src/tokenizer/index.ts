export interface Token {
  type: 'text' | 'match';
  value: string;
  index: number;
  groups?: string[]; // capture groups if your regex has them
}

export class SimpleTokenizer {
  private regex: RegExp;

  /**
   * Pass the regex here (it automatically makes it global so it finds ALL matches)
   */
  constructor(regex: RegExp) {
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    this.regex = new RegExp(regex.source, flags);
  }

  /**
   * Turn the whole string into a list of tokens:
   * - 'text'  = normal text between matches
   * - 'match' = whatever your regex found
   */
  tokenize(input: string): Token[] {
    this.regex.lastIndex = 0;
    const tokens: Token[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = this.regex.exec(input)) !== null) {
      // Text before this match
      if (match.index > lastIndex) {
        tokens.push({
          type: 'text',
          value: input.slice(lastIndex, match.index),
          index: lastIndex,
        });
      }

      // The matched part
      tokens.push({
        type: 'match',
        value: match[0],
        index: match.index,
        groups: match.slice(1), // any capture groups you defined
      });

      if (match[0].length === 0) {
        this.regex.lastIndex += 1;
      }
      lastIndex = this.regex.lastIndex;
    }

    // Remaining text after the last match
    if (lastIndex < input.length) {
      tokens.push({
        type: 'text',
        value: input.slice(lastIndex),
        index: lastIndex,
      });
    }

    return tokens;
  }

  /**
   * Replace only the matched tokens by calling the function.
   */
  replace(input: string, replacer: (token: Token) => string): string {
    return this.tokenize(input)
      .map((token) => (token.type === 'match' ? replacer(token) : token.value))
      .join('');
  }
}

export default {
  SimpleTokenizer,
};
