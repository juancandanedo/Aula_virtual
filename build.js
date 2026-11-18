// Se ejecuta en Netlify en cada despliegue: genera js/config.js a partir de las
// variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY (Site configuration → Environment variables).
// Si no están definidas, deja intacto el js/config.js del repositorio.
const fs = require('fs');
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.log('Variables SUPABASE_URL / SUPABASE_ANON_KEY no definidas: se usa js/config.js tal cual.'); process.exit(0); }
const cfg = { SUPABASE_URL: url.trim(), SUPABASE_ANON_KEY: key.trim(), SITE_NAME: (process.env.SITE_NAME || 'Aula Virtual').trim() };
fs.writeFileSync('js/config.js', '// Generado automáticamente por build.js\nwindow.CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
console.log('js/config.js generado desde variables de entorno.');
