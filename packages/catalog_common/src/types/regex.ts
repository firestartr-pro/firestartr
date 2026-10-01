const regModuleName = /[\w\-.]+/;

export const TFWorkspaceRefRegex = new RegExp(
  `\\$\\{\\{\\s*tfworkspace\\:(${regModuleName.source})\\:outputs\\.(${regModuleName.source})\\s*\\}\\}`,
  'ig',
);

// example of secret ref: ${{secret:my-secret.password}}
export const SecretRefRegex = new RegExp(
  `\\$\\{\\{\\s*secret\\:(${regModuleName.source})\\.(${regModuleName.source})\\s*\\}\\}`,
  'ig',
);

export const GroupRefRegex = new RegExp(
  `group\\:(${regModuleName.source})`,
  'ig',
);

export const TFWorkspaceRefCR = new RegExp(
  `\\$\\{\\{\\s*references\\.(${regModuleName.source})\\s*\\}\\}`,
  'i',
);

export const GenericRefRegex = new RegExp(
  `^["']?(user:${regModuleName.source}|group:${regModuleName.source}|domain:${regModuleName.source}|system:${regModuleName.source})["']?$`,
  'gm',
);

export const YAMLHeaderRegex = new RegExp(/^\s*(\w+:\s?)/);
export const YAMLListItemRegex = new RegExp(/^\s*(-\s)/);
export const YAMLInlineListRegex = new RegExp(/^\s*(\[.+\])/);
export const YAMLMultilineRegex = new RegExp(/^\s*([>|][-+]?)/);
