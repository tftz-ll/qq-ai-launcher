const path = require('node:path');
const { run } = require('./process.cjs');
async function prepareQzoneDependencies(root) {
  const runtime = path.join(root,'runtime');
  return run(path.join(runtime,'uv','uv.exe'),['pip','install','--python',path.join(root,'astrbot','.venv','Scripts','python.exe'),'--constraint',path.join(runtime,'astrbot-requirements.lock'),'--default-index','https://pypi.org/simple','json5','apilmoji[tqdm]>=0.3.0,<1.0.0'],{cwd:root,env:{UV_CACHE_DIR:path.join(runtime,'cache'),TEMP:path.join(runtime,'tmp'),TMP:path.join(runtime,'tmp')},timeout:180000});
}
module.exports = { prepareQzoneDependencies };
