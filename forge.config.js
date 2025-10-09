require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const smokeTestScript = path.join(__dirname, 'scripts', 'ffmpeg-smoke-test.js');

function runFfmpegSmokeTest(platform) {
    const result = spawnSync(process.execPath, [smokeTestScript, platform], {
        stdio: 'inherit',
        env: { ...process.env, FFMPEG_SMOKE_PLATFORM: platform },
    });

    if (result.status !== 0) {
        throw new Error(`FFmpeg smoke test failed for ${platform}`);
    }
}

module.exports = {
    packagerConfig: {
        asar: true,
        extraResource: ['./src/assets/SystemAudioDump', './src/assets/bin'],
        name: process.env.APP_NAME || 'Sales Wizard',
        icon: 'src/assets/logo',
        // use `security find-identity -v -p codesigning` to find your identity
        // for macos signing
        // also fuck apple
        // osxSign: {
        //    identity: '<paste your identity here>',
        //   optionsForFile: (filePath) => {
        //       return {
        //           entitlements: 'entitlements.plist',
        //       };
        //   },
        // },
        // notarize if off cuz i ran this for 6 hours and it still didnt finish
        // osxNotarize: {
        //    appleId: 'your apple id',
        //    appleIdPassword: 'app specific password',
        //    teamId: 'your team id',
        // },
    },
    rebuildConfig: {},
    hooks: {
        prePackage: async (_forgeConfig, options) => {
            runFfmpegSmokeTest(options.platform);
        },
    },
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'sales-wizard',
                productName: 'Sales Wizard',
                shortcutName: 'Sales Wizard',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
        },
        {
            name: '@reforged/maker-appimage',
            platforms: ['linux'],
            config: {
                options: {
                    name: 'Sales Wizard',
                    productName: 'Sales Wizard',
                    genericName: 'AI Assistant',
                    description: 'AI assistant for interviews and learning',
                    categories: ['Development', 'Education'],
                    icon: 'src/assets/logo.png',
                },
            },
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
