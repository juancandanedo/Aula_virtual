// Función de Netlify: el administrador crea estudiantes con contraseña, los matricula, o les cambia la contraseña.
// Variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (clave "service_role", SECRETA: solo en Netlify).
const requireAdmin = require('../lib/admin');
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
  if (!KEY) return json(500, { error: 'Falta la variable SUPABASE_SERVICE_ROLE_KEY en Netlify.' });
  const bad = await requireAdmin(event); if (bad) return json(bad.status, { error: bad.error });

  let input; try { input = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const password = String(input.password || '');

  try {
    if (input.action === 'delete') {
      const id = String(input.user_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'Usuario inválido' });
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${id}`, { headers: H });
      const rows = await pr.json();
      if (rows[0] && rows[0].role === 'admin') return json(403, { error: 'No se puede eliminar a un administrador.' });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H });
      if (!r.ok) { let d = {}; try { d = await r.json(); } catch (x) { /* */ } return json(502, { error: d.msg || d.message || ('Error ' + r.status) }); }
      return json(200, { ok: true });
    }
    if (password.length < 8) return json(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (input.action === 'reset') {
      const id = String(input.user_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'Usuario inválido' });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password }) });
      const d = await r.json();
      if (!r.ok) return json(502, { error: d.msg || d.message || d.error_description || ('Error ' + r.status) });
      return json(200, { ok: true });
    }

    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.full_name || '').trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Correo inválido' });
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
    });
    const d = await r.json();
    if (!r.ok) {
      const m = d.msg || d.message || d.error_description || '';
      if (r.status === 422 || /already|registered|exists/i.test(m)) return json(409, { error: 'Ese correo ya tiene cuenta. Usa «Nueva contraseña» en la lista de estudiantes.' });
      return json(502, { error: m || ('Error ' + r.status) });
    }
    const ids = (Array.isArray(input.subject_ids) ? input.subject_ids : []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
    let enrolled = 0, warn = '';
    if (ids.length) {
      const er = await fetch(`${SUPABASE_URL}/rest/v1/enrollments?on_conflict=student_id,subject_id`, {
        method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(ids.map((sid) => ({ student_id: d.id, subject_id: sid })))
      });
      if (er.ok) enrolled = ids.length;
      else { let m = ''; try { const e = await er.json(); m = e.message || ''; } catch (x) { /* */ } warn = 'El usuario se creó, pero no se pudo matricular: ' + (m || er.status); }
    }
    return json(200, { ok: true, id: d.id, enrolled, warn });
  } catch (e) { return json(502, { error: 'No se pudo contactar a Supabase' }); }
};
