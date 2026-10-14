// Local config plugin: materializes google-services.json at build time
// from the GOOGLE_SERVICES_JSON_B64 EAS secret, so the real file never
// lives in git. Without the env var (local dev) it's a no-op — the file
// already exists on dev machines.
const fs = require('fs');
const path = require('path');

module.exports = function withGoogleServicesJson(config) {
  const b64 = process.env.GOOGLE_SERVICES_JSON_B64;
  if (b64) {
    try {
      const root = (config && config._internal && config._internal.projectRoot) || process.cwd();
      fs.writeFileSync(
        path.join(root, 'google-services.json'),
        Buffer.from(String(b64), 'base64').toString('utf8')
      );
    } catch (e) {
      console.warn('[withGoogleServicesJson] could not write file:', e?.message || e);
    }
  }
  return config;
};
