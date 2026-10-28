// NapCat handles SIGINT itself; Node IPC provides a Windows-safe stop channel.
const path = require('node:path');
const target = path.resolve(process.argv[2]);
// NapCat interprets extra argv entries as a quick-login QQ number.
process.argv = [process.execPath,target,...process.argv.slice(3)];
process.on('message',message => {
  if(message?.type === 'qqai-stop') {
    if(process.listenerCount('SIGINT')) process.emit('SIGINT');
    else process.exit(0);
  }
});
require(target);
