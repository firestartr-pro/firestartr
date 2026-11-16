import { WriterRequiredProvider } from '../src/writer_required_provider';

describe('WriterRequiredProvider', () => {
  it('renders both source and version when provided', async () => {
    const writer = new WriterRequiredProvider(
      'aws',
      'hashicorp/aws',
      '5.0.0',
    );

    const output = await writer.render();

    expect(output).toContain('source = "hashicorp/aws"');
    expect(output).toContain('version = "5.0.0"');
  });

  it('omits source when it is undefined, instead of rendering "undefined"', async () => {
    const writer = new WriterRequiredProvider('aws', undefined, '5.0.0');

    const output = await writer.render();

    expect(output).not.toContain('undefined');
    expect(output).not.toContain('source');
    expect(output).toContain('version = "5.0.0"');
  });

  it('omits version when it is undefined, instead of rendering "undefined"', async () => {
    const writer = new WriterRequiredProvider('aws', 'hashicorp/aws', undefined);

    const output = await writer.render();

    expect(output).not.toContain('undefined');
    expect(output).not.toContain('version');
    expect(output).toContain('source = "hashicorp/aws"');
  });

  it('omits both source and version when neither is provided', async () => {
    const writer = new WriterRequiredProvider('aws', undefined, undefined);

    const output = await writer.render();

    expect(output).not.toContain('undefined');
    expect(output).not.toContain('source');
    expect(output).not.toContain('version');
  });
});
