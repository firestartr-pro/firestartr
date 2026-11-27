module.exports = ({ core }) => {
  const { PACKAGE_VERSION } = process.env
  const { PACKAGE } = process.env

  if (!PACKAGE_VERSION) {
    core.error('PACKAGE_VERSION environment variable is not set');
    console.error('PACKAGE_VERSION environment variable is not set');
    process.exit(1);
  }

  if (!PACKAGE) {
    core.error('PACKAGE environment variable is not set');
    console.error('PACKAGE environment variable is not set');
    process.exit(1);
  }

  const fs = require('fs');

  // semver is a root dependency, installed by the `npm ci` that runs before
  // this script. Never `npm install` it here: that bumps it in the root
  // package.json and package-lock.json and pollutes the bump PR.
  const semver = require('semver');

  // Validate version with semver
  if (!semver.valid(PACKAGE_VERSION)) {
    core.error(`Invalid version: ${PACKAGE_VERSION}`);
    console.error(`Invalid version format: ${PACKAGE_VERSION}`);
    process.exit(1);
  }

  const filePath = `packages/${PACKAGE}/package.json`
  console.info(`Reading package.json in ${filePath}`)
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Handle 'v' prefix if present
  pkg.version = PACKAGE_VERSION;
  if (PACKAGE_VERSION.startsWith('v')){
      pkg.version = PACKAGE_VERSION.substring(1)
  } else {
      pkg.version = PACKAGE_VERSION
  }

  // Log updated version
  console.info(`Version: ${pkg.version}`);
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2));
  core.info(`Updated package.json with version: ${pkg.version}`);
  core.info(`Is pre-release: ${semver.prerelease(pkg.version) !== null}`);

  return {
    version: pkg.version,
    isPreRelease: semver.prerelease(pkg.version) !== null
  };
}
