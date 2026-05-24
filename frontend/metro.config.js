const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /android[\/\\]app[\/\\]\.cxx[\/\\].*/,
];

module.exports = config;
