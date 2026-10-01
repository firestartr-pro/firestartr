import { ICustomResourcePatch } from '../patches';

const EXCEPTION_REG = new RegExp(/^\^.+/);

export function helperIsPatchApplicable(
  chart: any,
  patch: ICustomResourcePatch,
) {
  if (!patch.applicable) {
    throw `helperIsPatchApplicable: patch has no applicable section: ${patch.identify()}`;
  }

  const patchApplicability = patch.applicable();

  if (patchApplicability.applicableProviders.includes('all')) {
    return true;
  } else if (
    patchApplicability.applicableProviders.some((provider: string) =>
      provider.match(EXCEPTION_REG),
    )
  ) {
    const [exception] = patchApplicability.applicableProviders.filter(
      (provider: string) => provider.match(EXCEPTION_REG),
    );

    return !exception
      .replace(/\^/, '')
      .split(',')
      .includes(chart.get('provider'));
  } else {
    return patchApplicability.applicableProviders.includes(
      chart.get('provider'),
    );
  }
}
