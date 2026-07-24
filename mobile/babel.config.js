/** Expo + NativeWind. */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // reanimated is only a transitive/optional peer of NativeWind and is not
      // used by the app; disabling it avoids pulling react-native-worklets.
      ["babel-preset-expo", { jsxImportSource: "nativewind", reanimated: false }],
      "nativewind/babel",
    ],
  };
};
