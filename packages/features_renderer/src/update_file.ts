import path from 'path';

import fs from 'fs';

export default function updateFileContent(
  featureRenderPath: string,
  filePath: string,
  content: string,
) {
  fs.writeFileSync(
    path.join(featureRenderPath, filePath),

    content,
  );
}
