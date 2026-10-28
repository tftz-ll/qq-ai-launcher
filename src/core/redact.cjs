const SENSITIVE = /key|token|password|secret|credential|authorization|cookie|qrcode|uin|user_?id|group_?id|system_prompt|persona|prompt|message|content/i;
function redact(value, secrets = []) {
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[已隐藏]' : redact(v, secrets)]));
  if (typeof value !== 'string') return value;
  let text = value.replace(/\x1b\[[0-9;]*m/g, '');
  for (const secret of secrets.flat(Infinity).filter(s => typeof s === 'string' && s.length >= 4).sort((a,b) => b.length-a.length)) text = text.split(secret).join('[已隐藏]');
  return text.replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]').replace(/(Bearer\s+)\S+/gi, '$1[已隐藏]').replace(/([?&](?:token|key|access_token|auth)=)[^&\s]+/gi, '$1[已隐藏]');
}
module.exports = { redact };
