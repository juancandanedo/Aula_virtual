// Función de Netlify: redacta el guion (notas del orador) de UNA diapositiva con Claude.
// Variables de entorno: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY. Opcional: ANTHROPIC_MODEL (por defecto claude-haiku-5-5)
const requireAdmin = require('../lib/admin');
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: 'Falta la variable ANTHROPIC_API_KEY en Netlify.' });
  const bad = await requireAdmin(event); if (bad) return json(bad.status, { error: bad.error });

  let input; try { input = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }
  const text = String(input.text || '').slice(0, 6000);
  const title = String(input.title || '').slice(0, 200);
  const prevNotes = String(input.prev || '').slice(0, 800);
  const image = /^https:\/\//.test(input.image || '') ? input.image : null;
  const words = Math.max(40, Math.min(200, parseInt(input.words, 10) || 90));
  if (text.trim().length < 15 && !image) return json(400, { error: 'La diapositiva no tiene contenido para redactar notas.' });

  const instructions = `Eres el profesor de una clase de ingeniería (HVAC/MEP) y vas a narrar esta diapositiva en voz alta.
Escribe el guion EN ESPAÑOL, en primera persona, tono cercano y profesional, de unas ${words} palabras.
Reglas:
- Explica y da contexto con la información de la diapositiva; no la leas literalmente ni inventes datos, cifras o normas que no aparezcan.
- Pensado para ser leído por una voz sintética: frases cortas, sin viñetas, sin markdown, sin emojis ni paréntesis largos.
- Escribe las unidades y símbolos como se pronuncian (por ejemplo "pies por minuto", "pulgadas de columna de agua", "pies cúbicos por minuto", "delta T").
- No digas "en esta diapositiva"; empieza directo con la idea. No repitas lo ya dicho en la nota anterior (si se da).
- Responde SOLO con el guion.`;
  const content = [{ type: 'text', text: `${instructions}\n\nTítulo: ${title}\nTexto de la diapositiva:\n${text}${prevNotes ? `\n\nNota de la diapositiva anterior (para dar continuidad):\n${prevNotes}` : ''}` }];
  if (image) content.push({ type: 'image', source: { type: 'url', url: image } });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 700, messages: [{ role: 'user', content }] })
    });
    const data = await r.json();
    if (!r.ok) return json(502, { error: 'Error de la API de Anthropic: ' + ((data.error && data.error.message) || r.status) });
    const notes = (data.content || []).map((b) => b.text || '').join('').trim();
    if (!notes) return json(502, { error: 'La IA no devolvió texto. Intenta de nuevo.' });
    return json(200, { notes });
  } catch (e) { return json(502, { error: 'No se pudo contactar la API de Anthropic' }); }
};
