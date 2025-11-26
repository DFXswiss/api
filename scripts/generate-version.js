const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function getPackageVersion() {
  try {
    const packageJson = require('../package.json');
    return packageJson.version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

const versionInfo = {
  commit: getGitCommit(),
  branch: getGitBranch(),
  version: getPackageVersion(),
  buildTime: new Date().toISOString(),
};

const outputPath = join(__dirname, '..', 'dist', 'version.json');
writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));

console.log('Version info generated:', versionInfo);
