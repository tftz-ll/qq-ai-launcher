const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['snapshot','pickFolder','inspect','install','start','stop','reconnect','testModel','saveSettings','openPanel','copyCredential','exportDiagnostic','appearance','verifyChain','installQzone','qzoneStatus','qzoneAction','pickQzoneImage','exit','hide']);
contextBridge.exposeInMainWorld('qqai', {
  invoke: async (action,input) => {
    if(!actions.has(action)) throw new Error('未知操作。');
    const result = await ipcRenderer.invoke('action',action,input);
    if(!result.ok) throw new Error(result.error);
    return result.data;
  },
  onProgress: callback => { const handler = (_,data) => callback(data); ipcRenderer.on('progress',handler); return () => ipcRenderer.removeListener('progress',handler); },
});
