// Función de Netlify: convierte texto en audio MP3 con ElevenLabs.
// Variables de entorno: ELEVENLABS_API_KEY (secreta), ELEVENLABS_VOICE_ID, SUPABASE_URL, SUPABASE_ANON_KEY
// Opcionales: ELEVENLABS_MODEL (por defecto eleven_multilingual_v2)
const requireAdmin = require('../lib/admin');
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return json(500, { error: 'Faltan ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID en Netlify.' });
  const bad = await requireAdmin(event); if (bad) return json(bad.status, { error: bad.error });

  let input; try { input = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }
  const text = String(input.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < 5) return json(400, { error: 'No hay texto para convertir en audio.' });
  if (text.length > 4000) return json(400, { error: 'El texto es muy largo (máx. 4000 caracteres). Divídelo.' });
  const voice = /^[A-Za-z0-9]{10,40}$/.test(input.voice || '') ? input.voice : ELEVENLABS_VOICE_ID;

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_96`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8 } })
    });
    if (!r.ok) {
      let msg = r.status; try { const e = await r.json(); msg = (e.detail && (e.detail.message || e.detail)) || msg; } catch (e) { /* */ }
      return json(502, { error: 'Error de ElevenLabs: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { statusCode: 200, isBase64Encoded: true, headers: { 'Content-Type': 'audio/mpeg' }, body: buf.toString('base64') };
  } catch (e) { return json(502, { error: 'No se pudo contactar a ElevenLabs' }); }
};
