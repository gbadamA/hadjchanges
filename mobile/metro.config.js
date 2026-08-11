// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `socket.io-client` (via `engine.io-client`) publie un build ESM dont Metro ne
 * résout pas les imports relatifs sans le champ `exports` du package.json —
 * d'où un « Unable to resolve ./contrib/parseuri.js » qui n'a rien à voir avec
 * notre code. L'activation explicite règle la résolution.
 */
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
