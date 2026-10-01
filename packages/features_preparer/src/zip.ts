import * as fs from 'fs';

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { pipeline } from 'node:stream/promises';

export async function downloadZipBall(url: string, filePath: string) {
  try {
    const zipResponse = await fetch(url);

    if (!zipResponse.ok) {
      throw new Error(`Failed to download ZIP: ${zipResponse.statusText}`);
    }

    const webStream = zipResponse.body as NodeReadableStream;
    const stream = Readable.fromWeb(webStream);

    const writableStream = fs.createWriteStream(filePath);
    await pipeline(stream, writableStream);
  } catch (err) {
    throw new Error(`Downloading feature's zip: ${err.message}`);
  }
}
