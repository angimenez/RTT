const { QvacForgePlugin } = require('@qvac/sdk/electron-forge')

module.exports = {
  packagerConfig: { name: 'rtt' },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }],
  plugins: [new QvacForgePlugin({ logLevel: 'info' })]
}
