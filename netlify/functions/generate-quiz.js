// Función de Netlify: genera preguntas de quiz con Claude a partir del contenido de un capítulo.
// Variables de entorno necesarias en Netlify: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// Opcional: ANTHROPIC_MODEL (por defecto claude-haiku-5-5, rápido y económico)
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) return json(500, { error: 'Falta la variable ANTHROPIC_API_KEY en Netlify.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { error: 'Faltan SUPABASE_URL / SUPABASE_ANON_KEY en Netlify.' });

  // 1) solo administradores
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'No autenticado' });
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!u.ok) return json(401, { error: 'Sesión inválida' });
    const user = await u.json();
    const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const rows = await p.json();
    if (!rows[0] || rows[0].role !== 'admin') return json(403, { error: 'Solo el administrador puede generar quices' });
  } catch (e) { return json(500, { error: 'No se pudo verificar la sesión' }); }

  // 2) entrada
  let input;
  try { input = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }
  const count = Math.max(3, Math.min(30, parseInt(input.count, 10) || 10));
  const text = String(input.text || '').slice(0, 80000);
  const images = (Array.isArray(input.images) ? input.images : []).filter((u) => /^https:\/\//.test(u)).slice(0, 20);
  if (text.trim().length < 40 && !images.length) return json(400, { error: 'No hay contenido suficiente en el capítulo' });

  const instructions = `Eres un profesor experto en ingeniería. Con el material de clase que se te entrega (texto de diapositivas e imágenes de diapositivas), crea un quiz de ${count} preguntas de opción múltiple EN ESPAÑOL.
Reglas:
- Evalúa comprensión de los conceptos, normas, datos y relaciones del material; no preguntes por el diseño de las diapositivas ni por quién es el profesor.
- Usa SOLO información que aparezca en el material.
- Cada pregunta: 4 opciones, exactamente una correcta; las incorrectas deben ser plausibles; varía la posición de la correcta.
- Incluye una explicación breve (1-2 frases) de por qué la correcta es correcta.
- Responde ÚNICAMENTE con un arreglo JSON, sin texto adicional ni bloques de código, con este formato:
[{"question":"...","options":["...","...","...","..."],"correct":0,"explanation":"..."}]
("correct" es el índice 0-3 de la opción correcta).`;

  const content = [];
  content.push({ type: 'text', text: `${instructions}\n\n=== TEXTO DEL MATERIAL ===\n${text}` });
  images.forEach((u, i) => { content.push({ type: 'text', text: `Imagen de diapositiva ${i + 1}:` }); content.push({ type: 'image', source: { type: 'url', url: u } }); });

  // 3) llamada a Claude
  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    data = await r.json();
    if (!r.ok) return json(502, { error: 'Error de la API de Anthropic: ' + ((data.error && data.error.message) || r.status) });
  } catch (e) { return json(502, { error: 'No se pudo contactar la API de Anthropic' }); }

  // 4) parseo y validación
  const raw = (data.content || []).map((b) => b.text || '').join('');
  const m = raw.match(/\[[\s\S]*\]/);
  let arr;
  try { arr = JSON.parse(m ? m[0] : raw); } catch (e) { return json(502, { error: 'La IA no devolvió un JSON válido. Intenta de nuevo.' }); }
  const questions = (Array.isArray(arr) ? arr : []).map((q) => ({
    question: String(q.question || '').trim(),
    options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
    correct: Number.isInteger(q.correct) ? q.correct : 0,
    explanation: String(q.explanation || '').trim()
  })).filter((q) => q.question && q.options.length >= 2 && q.correct >= 0 && q.correct < q.options.length);
  if (!questions.length) return json(502, { error: 'La IA no generó preguntas válidas. Intenta de nuevo.' });
  return json(200, { questions });
};
