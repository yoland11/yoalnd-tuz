/** Expo + NativeWind. */
const nativeWind = require("nativewind/babel");

function nativeWindForSdk53() {
  const preset = nativeWind();
  return {
    ...preset,
    // Expo SDK 53 uses Reanimated 3, whose plugin is added by babel-preset-expo.
    plugins: preset.plugins.filter((plugin) => plugin !== "react-native-worklets/plugin"),
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      nativeWindForSdk53,
    ],
  };
};
