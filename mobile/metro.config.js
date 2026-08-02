// Metro config so the app can import the shared, portable core at ../shared/core.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the repo root so Metro can read shared/core/* (which lives outside mobile/).
config.watchFolders = [repoRoot];

// Resolve node_modules from the app first, then the repo root as a fallback.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

// `@teammetrics/core` is a `file:../shared/core` dependency → npm symlinks it into
// node_modules, and Metro resolves it via normal lookup (+ watchFolders above so it
// can read the real files outside mobile/).

module.exports = config;
