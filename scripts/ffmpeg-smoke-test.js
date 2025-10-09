#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const platform = process.argv[2] || process.env.FFMPEG_SMOKE_PLATFORM || process.platform;
const repoRoot = path.join(__dirname, '..');
const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

const candidates = [];

const envOverride = process.env.SW_FFMPEG_PATH || process.env.FFMPEG_PATH;
if (envOverride) {
    candidates.push(envOverride);
}

const assetCandidate = path.join(repoRoot, 'src', 'assets', 'bin', platform, binaryName);
candidates.push(assetCandidate);

if (platform !== 'win32') {
    candidates.push('ffmpeg');
} else {
    candidates.push('ffmpeg.exe');
}

const checked = [];

for (const candidate of candidates) {
    if (!candidate || checked.includes(candidate)) continue;
    checked.push(candidate);

    const isAbsolute = path.isAbsolute(candidate) || candidate.includes(path.sep);
    if (isAbsolute && !fs.existsSync(candidate)) {
        continue;
    }

    const result = spawnSync(candidate, ['-version'], {
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (result.status === 0) {
        console.log(`[ffmpeg-smoke] Detected ffmpeg for ${platform} at ${candidate}`);
        process.exit(0);
    }
}

console.error(`[ffmpeg-smoke] Unable to locate a working ffmpeg binary for platform ${platform}.`);
console.error('Checked locations:', checked.length ? checked.join(', ') : '(none)');
console.error('Ensure the binary is bundled in src/assets/bin/<platform>/ or set SW_FFMPEG_PATH.');
process.exit(1);
