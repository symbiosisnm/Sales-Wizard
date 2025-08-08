module.exports = {
  packagerConfig: {
    asar: true
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'cheating-daddy' }
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-deb', platforms: ['linux'] },
    { name: '@electron-forge/maker-rpm', platforms: ['linux'] }
  ]
};
