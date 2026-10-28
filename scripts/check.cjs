const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const dir of ['src','scripts','tests']) {
  if(!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir,{ recursive: true }).filter(n => /\.(?:cjs|js)$/.test(n))) {
    const file = path.join(dir,name);
    const result = spawnSync(process.execPath,['--check',file],{ encoding: 'utf8' });
    if(result.status) { process.stderr.write(result.stderr); process.exit(result.status); }
  }
}
console.log('JavaScript syntax checks passed.');
