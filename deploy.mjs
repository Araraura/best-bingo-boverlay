import { execSync } from 'node:child_process';

const HOST = 'root@livestreambingo.com';
const DIR = '/opt/boverlay';

const serverFiles = [
  'server.mjs',
  'admin.html',
  'video_overlay.html',
  'config.html',
  'styles.css',
  'backend-config.js',
  'package.json',
  'package-lock.json',
];
const distFiles = ['main.js', 'state.js', 'game.js', 'bingo.js', 'labels.js', 'admin.js'].map(
  (file) => `dist/${file}`,
);

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('npm run build');
run('npm run lint');
run(`scp ${serverFiles.join(' ')} ${HOST}:${DIR}/`);
run(`scp ${distFiles.join(' ')} ${HOST}:${DIR}/dist/`);
run(
  `ssh ${HOST} "cd ${DIR} && npm install --omit=dev && chown -R boverlay:boverlay ${DIR} && systemctl restart boverlay && sleep 1 && journalctl -u boverlay -n 5 --no-pager"`,
);

console.log('\ndeployed. scribe page: https://livestreambingo.com/admin.html');
console.log('reminder: frontend changes also need node package-extension.mjs + a zip upload to twitch.');
