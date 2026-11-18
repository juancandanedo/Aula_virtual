// Verifica que quien llama sea administrador (mismo criterio que generate-quiz).
module.exports = async function requireAdmin(event) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { status: 500, error: 'Faltan SUPABASE_URL / SUPABASE_ANON_KEY en Netlify.' };
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { status: 401, error: 'No autenticado' };
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!u.ok) return { status: 401, error: 'Sesión inválida' };
    const user = await u.json();
    const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const rows = await p.json();
    if (!rows[0] || rows[0].role !== 'admin') return { status: 403, error: 'Solo el administrador puede usar esta función' };
  } catch (e) { return { status: 500, error: 'No se pudo verificar la sesión' }; }
  return null;
};
