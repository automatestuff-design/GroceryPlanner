// Expo's default config detects the npm workspace, so packages/* resolve from source.
const { getDefaultConfig } = require("expo/metro-config");
module.exports = getDefaultConfig(__dirname);
