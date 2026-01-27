const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force Metro to resolve expo-asset to the root node_modules
config.resolver.extraNodeModules = {
  'expo-asset': require('resolve').sync('expo-asset', { basedir: __dirname }),
};

// Block nested resolution: Look ONLY in the root node_modules
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
