import { SimpleTokenizer, Token } from '../src/tokenizer';

describe('SimpleTokenizer', () => {
  const exampleRegex = /\{\{(\w+)\}\}/g;   
  let tokenizer: SimpleTokenizer;

  beforeEach(() => {
    tokenizer = new SimpleTokenizer(exampleRegex);
  });

  describe('tokenize()', () => {
    it('splits text into text + match tokens correctly', () => {
      const input = 'Hello {{name}}, welcome to {{city}} today!';

      const tokens = tokenizer.tokenize(input);

      expect(tokens).toEqual([
        { type: 'text', value: 'Hello ', index: 0 },
        { type: 'match', value: '{{name}}', index: 6, groups: ['name'] },
        { type: 'text', value: ', welcome to ', index: 14 },
        { type: 'match', value: '{{city}}', index: 27, groups: ['city'] },
        { type: 'text', value: ' today!', index: 35 },
      ]);
    });

    it('handles text with no matches', () => {
      const input = 'Just plain text, no placeholders here.';
      const tokens = tokenizer.tokenize(input);

      expect(tokens).toEqual([
        { type: 'text', value: input, index: 0 },
      ]);
    });

    it('handles matches at the very start and end', () => {
      const input = '{{start}} middle {{end}}';
      const tokens = tokenizer.tokenize(input);

      expect(tokens[0].type).toBe('match');
      expect(tokens[tokens.length - 1].type).toBe('match');
    });

    it('produces consistent results when the same instance tokenizes multiple strings', () => {
      const first = tokenizer.tokenize('Hello {{name}}');
      const second = tokenizer.tokenize('Goodbye {{place}}');

      expect(first.find(t => t.type === 'match')?.value).toBe('{{name}}');
      expect(second.find(t => t.type === 'match')?.value).toBe('{{place}}');
    });
  });

  describe('replace()', () => {
    it('replaces only matches using the custom function', () => {
      const input = 'Hello {{name}}! You are from {{city}}.';

      const result = tokenizer.replace(input, (token: Token) => {
        // token.groups[0] = the captured variable name
        const varName = token.groups?.[0] ?? '';
        return `<strong>${varName.toUpperCase()}</strong>`;
      });

      expect(result).toBe('Hello <strong>NAME</strong>! You are from <strong>CITY</strong>.');
    });

    it('leaves the original string untouched when there are no matches', () => {
      const input = 'No placeholders here';
      const result = tokenizer.replace(input, () => 'X');
      expect(result).toBe(input);
    });
  });
});
