module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // required by react-native-vision-camera frame processors + reanimated
      'react-native-worklets-core/plugin',
      'react-native-reanimated/plugin',
    ],
  };
};
