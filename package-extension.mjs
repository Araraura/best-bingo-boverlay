import { writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node package-extension.mjs <public backend url>');
  process.exit(1);
}
const host = new URL(arg.includes('://') ? arg : `https://${arg}`).host;
const backend = `wss://${host}`;

const out = 'extension-package';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

for (const file of ['video_overlay.html', 'config.html', 'styles.css']) {
  copyFileSync(file, join(out, file));
}
writeFileSync(join(out, 'backend-config.js'), `window.BOVERLAY_BACKEND = '${backend}';\n`);
for (const file of ['main.js', 'state.js', 'game.js', 'bingo.js', 'labels.js']) {
  copyFileSync(join('dist', file), join(out, 'dist', file));
}

execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${out}/*' -DestinationPath 'extension.zip' -Force"`, {
  stdio: 'inherit',
});
console.log(`\npackaged extension.zip -> backend ${backend}`);
console.log('upload extension.zip in the dev console Files tab, then move the version to Hosted Test.');
