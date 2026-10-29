// After `electron-builder --mac` on Linux: ad-hoc sign each Brusk.app (Apple Silicon refuses
// unsigned apps) with rcodesign, then zip it keeping the framework symlinks.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dist = path.resolve(process.argv[2] || 'dist-mac');
const version = require('../package.json').version;
for (const [dir, arch] of [['mac-arm64', 'arm64'], ['mac', 'x64']]) {
  const app = path.join(dist, dir, 'Brusk.app');
  if (!fs.existsSync(app)) continue;
  execFileSync('rcodesign', ['sign', app], { stdio: 'inherit' });
  const zip = path.join(dist, `Brusk-${version}-mac-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qry', zip, 'Brusk.app'], { cwd: path.dirname(app), stdio: 'inherit' });
  console.log('ok', zip);
}
