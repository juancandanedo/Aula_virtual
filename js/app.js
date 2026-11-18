/* =====================================================================
   AULA VIRTUAL — aplicación (estudiantes + administrador)
   Sin paso de compilación: se publica tal cual en Netlify.
   ===================================================================== */
(function () {
  'use strict';

  // ---------- arranque ----------
  const cfg = window.CONFIG || {};
  const app = document.getElementById('app');
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
    app.innerHTML = '<div class="auth"><div class="card"><h2>Falta configurar Supabase</h2><p>Edita <code>js/config.js</code> y pega la URL y la anon key de tu proyecto de Supabase. Los pasos están en el README.</p></div></div>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let me = null;           // perfil del usuario
  let cleanup = null;      // limpieza de la vista actual

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isAdmin = () => me && me.role === 'admin';
  const $ = (sel, root) => (root || app).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || app).querySelectorAll(sel));
  const on = (sel, evt, fn) => $$(sel).forEach((el) => el.addEventListener(evt, (e) => fn(el, e)));
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500);
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) { toast('Error: ' + error.message); throw error; }
    return data;
  }
  function busy(msg) {
    let el = document.getElementById('busy');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'modal-bg'; document.body.appendChild(el); }
    el.innerHTML = `<div class="modal"><h3>Un momento…</h3><p id="busymsg">${esc(msg)}</p></div>`;
  }
  const busyMsg = (m) => { const e = document.getElementById('busymsg'); if (e) e.textContent = m; };
  const fmtDate = (d) => new Date(d).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' });
  const byPos = (a, b) => a.position - b.position;

  function shell(inner, active) {
    const name = esc(me.full_name || me.email);
    app.innerHTML = `
      <div class="topbar">
        <a class="brand" href="#/">${esc(cfg.SITE_NAME || 'Aula Virtual')}</a>
        <nav>
          <a href="#/" class="${active === 'home' ? 'on' : ''}">Mis materias</a>
          ${isAdmin() ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Administración</a>` : ''}
        </nav>
        <span class="who">${name}${isAdmin() ? ' · admin' : ''}</span>
        <button class="btn ghost sm" id="logout">Salir</button>
      </div>
      <div id="page">${inner}</div>`;
    $('#logout').onclick = async () => { await sb.auth.signOut(); };
  }

  // ---------- autenticación ----------
  function loginView(mode, msg) {
    const reg = mode === 'register';
    app.innerHTML = `
      <div class="auth">
        <h1>${esc(cfg.SITE_NAME || 'Aula Virtual')}</h1>
        <div class="card">
          <h2>${reg ? 'Crear cuenta' : 'Iniciar sesión'}</h2>
          <form id="f">
            ${reg ? '<label>Nombre completo</label><input name="name" required autocomplete="name">' : ''}
            <label>Correo</label><input name="email" type="email" required autocomplete="email">
            <label>Contraseña</label><input name="pass" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}">
            <p class="err" id="err">${esc(msg || '')}</p>
            <button class="btn" style="width:100%;justify-content:center;margin-top:.8rem">${reg ? 'Registrarme' : 'Entrar'}</button>
          </form>
          <p class="small muted" style="text-align:center;margin-top:1rem">
            ${reg ? '¿Ya tienes cuenta? <a href="#" id="sw">Inicia sesión</a>' : '¿Primera vez? <a href="#" id="sw">Crea tu cuenta</a>'}
          </p>
          ${reg ? '<p class="small muted">Después de registrarte, el profesor te dará acceso a tus materias.</p>' : ''}
        </div>
      </div>`;
    $('#sw').onclick = (e) => { e.preventDefault(); loginView(reg ? 'login' : 'register'); };
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      $('#err').textContent = '';
      if (reg) {
        const { data, error } = await sb.auth.signUp({ email: f.get('email'), password: f.get('pass'), options: { data: { full_name: f.get('name') } } });
        if (error) { $('#err').textContent = error.message; return; }
        if (!data.session) loginView('login', 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('pass') });
        if (error) $('#err').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message;
      }
    };
  }

  async function loadProfile(user) {
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
    me = data || { id: user.id, email: user.email, role: 'student', full_name: '' };
  }

  // ---------- enrutador ----------
  async function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* nada */ } cleanup = null; }
    if (!me) return;
    const h = location.hash.replace(/^#\/?/, '');
    const p = h.split('/');
    try {
      if (!h) return await homeView();
      if (p[0] === 's' && p[1]) return await subjectView(p[1]);
      if (p[0] === 'm' && p[1]) return await moduleView(p[1]);
      if (p[0] === 'q' && p[1]) return await quizView(p[1]);
      if (p[0] === 'admin' && isAdmin()) {
        if (!p[1]) return await adminSubjects();
        if (p[1] === 'students') return await adminStudents();
        if (p[1] === 's' && p[2]) return await adminSubject(p[2]);
        if (p[1] === 'q' && p[2]) return await quizEditor(p[2]);
      }
      location.hash = '#/';
    } catch (e) {
      console.error(e);
      shell(`<div class="wrap"><div class="card"><h2>Algo salió mal</h2><p class="muted">${esc(e.message || e)}</p><a class="btn" href="#/">Volver al inicio</a></div></div>`, 'home');
    }
  }
  window.addEventListener('hashchange', route);

  // =====================================================================
  //  VISTAS DE ESTUDIANTE
  // =====================================================================
  async function homeView() {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'home');
    const [subjects, chapters, modules, prog] = await Promise.all([
      q(sb.from('subjects').select('*').order('position')),
      q(sb.from('chapters').select('id,subject_id')),
      q(sb.from('modules').select('id,chapter_id')),
      q(sb.from('module_progress').select('module_id').eq('student_id', me.id))
    ]);
    const done = new Set(prog.map((x) => x.module_id));
    const cardHtml = subjects.map((s) => {
      const chIds = new Set(chapters.filter((c) => c.subject_id === s.id).map((c) => c.id));
      const mods = modules.filter((m) => chIds.has(m.chapter_id));
      const d = mods.filter((m) => done.has(m.id)).length;
      const pct = mods.length ? Math.round((d / mods.length) * 100) : 0;
      return `<a class="card subject-card" href="#/s/${s.id}">
        <div class="row sb"><h2>${esc(s.title)}</h2>${s.published ? '' : '<span class="badge warn">Borrador</span>'}</div>
        <p>${esc(s.description)}</p>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="progress-note" style="margin-top:.35rem">${chIds.size} capítulos · ${mods.length} módulos · ${pct}% completado</div>
      </a>`;
    }).join('');
    $('#page').innerHTML = `<div class="wrap">
      <h1>Mis materias</h1>
      ${subjects.length ? `<div class="grid">${cardHtml}</div>` : `<div class="card"><p>${isAdmin() ? 'Aún no has creado materias. Ve a <a href="#/admin">Administración</a>.' : 'Todavía no tienes materias asignadas. Pídele al profesor que te dé acceso.'}</p></div>`}
    </div>`;
  }

  async function subjectView(id) {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'home');
    const subject = await q(sb.from('subjects').select('*').eq('id', id).single());
    const chapters = (await q(sb.from('chapters').select('*').eq('subject_id', id))).sort(byPos);
    const chIds = chapters.map((c) => c.id);
    const [modules, quizzes, prog, attempts] = chIds.length ? await Promise.all([
      q(sb.from('modules').select('id,chapter_id,title,position,slide_count').in('chapter_id', chIds)),
      q(sb.from('quizzes').select('id,chapter_id,title,pass_score').in('chapter_id', chIds)),
      q(sb.from('module_progress').select('module_id').eq('student_id', me.id)),
      q(sb.from('quiz_attempts').select('quiz_id,score,total').eq('student_id', me.id))
    ]) : [[], [], [], []];
    const done = new Set(prog.map((x) => x.module_id));
    const best = {};
    attempts.forEach((a) => { const pct = Math.round((a.score / a.total) * 100); best[a.quiz_id] = Math.max(best[a.quiz_id] || 0, pct); });

    const html = chapters.map((c, ci) => {
      const mods = modules.filter((m) => m.chapter_id === c.id).sort(byPos);
      const quiz = quizzes.find((z) => z.chapter_id === c.id);
      const d = mods.filter((m) => done.has(m.id)).length;
      return `<section class="card chapter">
        <header class="row sb"><h2 style="margin:0">Capítulo ${ci + 1}: ${esc(c.title)}</h2><span class="badge ${mods.length && d === mods.length ? 'ok' : ''}">${d}/${mods.length} módulos</span></header>
        ${mods.map((m, mi) => `<div class="item"><span class="ic ${done.has(m.id) ? 'done' : ''}">${done.has(m.id) ? '✓' : mi + 1}</span>
          <a class="grow" href="#/m/${m.id}">${esc(m.title)}</a><span class="muted small">${m.slide_count} diap.</span></div>`).join('') || '<div class="item muted">Sin módulos todavía</div>'}
        ${quiz ? `<div class="item quiz"><span class="ic">?</span><a class="grow" href="#/q/${c.id}"><b>${esc(quiz.title)}</b></a>
          ${best[quiz.id] != null ? `<span class="badge ${best[quiz.id] >= quiz.pass_score ? 'ok' : 'bad'}">Mejor nota: ${best[quiz.id]}%</span>` : '<span class="badge">Pendiente</span>'}</div>` : ''}
      </section>`;
    }).join('');

    $('#page').innerHTML = `<div class="wrap">
      <div class="crumbs"><a href="#/">Mis materias</a> › ${esc(subject.title)}</div>
      <div class="row sb"><h1>${esc(subject.title)}</h1>${isAdmin() ? `<a class="btn ghost sm" href="#/admin/s/${id}">Editar estructura</a>` : ''}</div>
      <p class="muted">${esc(subject.description)}</p>
      ${html || '<div class="card muted">Esta materia aún no tiene capítulos.</div>'}
    </div>`;
  }

  async function moduleView(id) {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'home');
    const mod = await q(sb.from('modules').select('*').eq('id', id).single());
    const chapter = await q(sb.from('chapters').select('*').eq('id', mod.chapter_id).single());
    const [subject, siblings, quiz, prog] = await Promise.all([
      q(sb.from('subjects').select('id,title').eq('id', chapter.subject_id).single()),
      q(sb.from('modules').select('id,title,position').eq('chapter_id', chapter.id)),
      q(sb.from('quizzes').select('id').eq('chapter_id', chapter.id).maybeSingle()),
      q(sb.from('module_progress').select('module_id').eq('student_id', me.id).eq('module_id', id))
    ]);
    const order = siblings.sort(byPos);
    const pos = order.findIndex((m) => m.id === id);
    const next = order[pos + 1];
    const slides = mod.slides || [];
    let idx = 0, completed = prog.length > 0;

    $('#page').innerHTML = `
      <div class="viewer">
        <aside class="side">${slides.map((s, i) => `<button data-i="${i}"><span>${i + 1}</span>${esc(s.title || 'Diapositiva ' + (i + 1))}${s.notes ? ' <em class="nt" title="Tiene notas">✎</em>' : ''}</button>`).join('')}</aside>
        <main>
          <div class="crumbs"><a href="#/">Mis materias</a> › <a href="#/s/${subject.id}">${esc(subject.title)}</a> › ${esc(chapter.title)} › <b>${esc(mod.title)}</b></div>
          <div class="stage-wrap" id="wrap"><div class="stage" id="stage"><div class="inner" id="inner"></div></div></div>
          <div class="controls">
            <div class="row"><button class="btn ghost" id="prev">← Anterior</button><span id="count" class="muted"></span><button class="btn" id="nextb">Siguiente →</button></div>
            <div class="row"><button class="btn ghost sm" id="fs">Pantalla completa</button>
              <span id="done" class="badge ${completed ? 'ok' : ''}">${completed ? '✓ Completado' : 'En progreso'}</span></div>
          </div>
          <details class="card notes" id="notes" hidden open><summary>Notas de la clase</summary><div id="notesbody"></div></details>
          <div class="card" id="endcard" style="margin-top:1rem" hidden>
            <h3>Terminaste este módulo</h3>
            <div class="row">
              ${next ? `<a class="btn" href="#/m/${next.id}">Siguiente módulo: ${esc(next.title)} →</a>` : ''}
              ${quiz ? `<a class="btn" href="#/q/${chapter.id}">Hacer el quiz del capítulo</a>` : ''}
              <a class="btn ghost" href="#/s/${subject.id}">Volver a la materia</a>
            </div>
          </div>
        </main>
      </div>`;

    const wrap = $('#wrap'), stage = $('#stage'), inner = $('#inner');
    function fit() {
      const fsOn = !!document.fullscreenElement;
      const availW = wrap.clientWidth - (fsOn ? 0 : 26);
      const availH = fsOn ? window.innerHeight - 10 : Math.max(300, window.innerHeight - 230);
      const s = Math.max(0.15, Math.min(availW / mod.slide_w, availH / mod.slide_h));
      inner.style.transform = `scale(${s})`;
      stage.style.width = mod.slide_w * s + 'px'; stage.style.height = mod.slide_h * s + 'px';
    }
    async function markDone() {
      if (completed || isAdmin()) return;
      completed = true;
      await sb.from('module_progress').upsert({ student_id: me.id, module_id: id }, { onConflict: 'student_id,module_id', ignoreDuplicates: true });
      const b = $('#done'); if (b) { b.className = 'badge ok'; b.textContent = '✓ Completado'; }
    }
    function show(i) {
      if (!slides.length) { inner.innerHTML = '<p style="padding:2rem">Este módulo no tiene diapositivas.</p>'; return; }
      idx = Math.max(0, Math.min(slides.length - 1, i));
      inner.innerHTML = slides[idx].html;
      $('#count').textContent = `${idx + 1} / ${slides.length}`;
      const nt = slides[idx].notes || '';
      $('#notes').hidden = !nt; $('#notesbody').innerHTML = nt ? nt.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('') : '';
      $$('.side button').forEach((b) => b.classList.toggle('on', +b.dataset.i === idx));
      const last = idx === slides.length - 1;
      $('#endcard').hidden = !last;
      if (last) markDone();
      const active = $('.side button.on'); if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }
    $('#prev').onclick = () => show(idx - 1);
    $('#nextb').onclick = () => show(idx + 1);
    $('#fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.requestFullscreen && wrap.requestFullscreen(); };
    on('.side button', 'click', (b) => show(+b.dataset.i));
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(idx + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(idx - 1); }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    cleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); };
    fit(); show(0);
  }

  async function quizView(chapterId) {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'home');
    const chapter = await q(sb.from('chapters').select('*').eq('id', chapterId).single());
    const subject = await q(sb.from('subjects').select('id,title').eq('id', chapter.subject_id).single());
    const quiz = await q(sb.from('quizzes').select('*').eq('chapter_id', chapterId).maybeSingle());
    const crumbs = `<div class="crumbs"><a href="#/">Mis materias</a> › <a href="#/s/${subject.id}">${esc(subject.title)}</a> › ${esc(chapter.title)}</div>`;
    if (!quiz) { $('#page').innerHTML = `<div class="wrap">${crumbs}<div class="card">Este capítulo no tiene quiz.</div></div>`; return; }
    const questions = (await q(sb.from('quiz_questions').select('*').eq('quiz_id', quiz.id))).sort(byPos);
    const attempts = (await q(sb.from('quiz_attempts').select('*').eq('quiz_id', quiz.id).eq('student_id', me.id).order('created_at', { ascending: false })));

    function renderForm() {
      $('#page').innerHTML = `<div class="wrap">${crumbs}
        <h1>${esc(quiz.title)}</h1>
        <p class="muted">${questions.length} preguntas · Nota mínima para aprobar: ${quiz.pass_score}%</p>
        ${attempts.length ? `<p class="small muted">Intentos anteriores: ${attempts.map((a) => `${Math.round(a.score / a.total * 100)}%`).join(' · ')}</p>` : ''}
        <form id="qf">${questions.map((qq, i) => `<div class="card q"><b>${i + 1}. ${esc(qq.question)}</b>
          ${(qq.options || []).map((o, oi) => `<label class="opt"><input type="radio" name="q${i}" value="${oi}" required> <span>${esc(o)}</span></label>`).join('')}</div>`).join('')}
          ${questions.length ? '<button class="btn">Enviar respuestas</button>' : '<div class="card muted">Este quiz todavía no tiene preguntas.</div>'}
        </form></div>`;
      const f = $('#qf'); if (f) f.onsubmit = (e) => { e.preventDefault(); grade(new FormData(f)); };
    }

    async function grade(fd) {
      const answers = questions.map((_, i) => +fd.get('q' + i));
      const score = questions.filter((qq, i) => answers[i] === qq.correct).length;
      const pct = Math.round((score / questions.length) * 100);
      if (!isAdmin()) {
        const { error } = await sb.from('quiz_attempts').insert({ quiz_id: quiz.id, student_id: me.id, score, total: questions.length, answers });
        if (error) toast('No se pudo guardar la nota: ' + error.message);
        else attempts.unshift({ score, total: questions.length });
      }
      const pass = pct >= quiz.pass_score;
      $('#page').innerHTML = `<div class="wrap">${crumbs}
        <div class="card" style="text-align:center"><div class="score" style="color:${pass ? 'var(--ok)' : 'var(--bad)'}">${pct}%</div>
          <p>${score} de ${questions.length} correctas — <b>${pass ? '¡Aprobado!' : 'No alcanzaste la nota mínima'}</b></p>
          <div class="row" style="justify-content:center"><button class="btn" id="retry">Intentar de nuevo</button><a class="btn ghost" href="#/s/${subject.id}">Volver a la materia</a></div></div>
        ${questions.map((qq, i) => `<div class="card q"><b>${i + 1}. ${esc(qq.question)}</b>
          ${(qq.options || []).map((o, oi) => `<div class="opt ${oi === qq.correct ? 'right' : (oi === answers[i] ? 'wrong' : '')}">${oi === qq.correct ? '✓' : (oi === answers[i] ? '✗' : '&nbsp;')} <span>${esc(o)}</span></div>`).join('')}
          ${qq.explanation ? `<div class="expl">${esc(qq.explanation)}</div>` : ''}</div>`).join('')}</div>`;
      $('#retry').onclick = renderForm;
      window.scrollTo(0, 0);
    }
    renderForm();
  }

  // =====================================================================
  //  VISTAS DE ADMINISTRADOR
  // =====================================================================
  const adminTabs = (on_) => `<div class="tabs"><a href="#/admin" class="${on_ === 'subjects' ? 'on' : ''}">Materias</a><a href="#/admin/students" class="${on_ === 'students' ? 'on' : ''}">Estudiantes y notas</a></div>`;

  async function reorder(table, list, i, dir) {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await Promise.all(ids.map((id, k) => q(sb.from(table).update({ position: k }).eq('id', id))));
  }

  async function adminSubjects() {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'admin');
    const subjects = (await q(sb.from('subjects').select('*'))).sort(byPos);
    $('#page').innerHTML = `<div class="wrap">${adminTabs('subjects')}
      <div class="row sb"><h1>Materias</h1><button class="btn" id="new">+ Nueva materia</button></div>
      ${subjects.map((s, i) => `<div class="card row">
        <div class="grow"><h3 style="margin:0">${esc(s.title)}</h3><span class="muted small">${esc(s.description)}</span></div>
        <span class="badge ${s.published ? 'ok' : 'warn'}">${s.published ? 'Publicada' : 'Borrador'}</span>
        <button class="btn ghost sm" data-up="${i}">↑</button><button class="btn ghost sm" data-down="${i}">↓</button>
        <a class="btn sm" href="#/admin/s/${s.id}">Editar</a><a class="btn ghost sm" href="#/s/${s.id}">Vista previa</a>
      </div>`).join('') || '<div class="card muted">Crea tu primera materia para empezar.</div>'}
    </div>`;
    $('#new').onclick = async () => {
      const title = prompt('Nombre de la materia:'); if (!title) return;
      const row = await q(sb.from('subjects').insert({ title, position: subjects.length }).select().single());
      location.hash = '#/admin/s/' + row.id;
    };
    on('[data-up]', 'click', async (b) => { await reorder('subjects', subjects, +b.dataset.up, -1); route(); });
    on('[data-down]', 'click', async (b) => { await reorder('subjects', subjects, +b.dataset.down, 1); route(); });
  }

  async function adminSubject(id) {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'admin');
    const subject = await q(sb.from('subjects').select('*').eq('id', id).single());
    const chapters = (await q(sb.from('chapters').select('*').eq('subject_id', id))).sort(byPos);
    const chIds = chapters.map((c) => c.id);
    const [modules, quizzes] = chIds.length ? await Promise.all([
      q(sb.from('modules').select('id,chapter_id,title,position,slide_count').in('chapter_id', chIds)),
      q(sb.from('quizzes').select('id,chapter_id').in('chapter_id', chIds))
    ]) : [[], []];
    const qCounts = {};
    if (quizzes.length) {
      const qs = await q(sb.from('quiz_questions').select('quiz_id').in('quiz_id', quizzes.map((z) => z.id)));
      qs.forEach((x) => { qCounts[x.quiz_id] = (qCounts[x.quiz_id] || 0) + 1; });
    }

    $('#page').innerHTML = `<div class="wrap">
      <div class="crumbs"><a href="#/admin">Administración</a> › ${esc(subject.title)}</div>
      <div class="card">
        <label style="margin-top:0">Nombre de la materia</label><input id="s_title" value="${esc(subject.title)}">
        <label>Descripción</label><textarea id="s_desc" rows="2">${esc(subject.description)}</textarea>
        <div class="row" style="margin-top:.8rem">
          <label class="row" style="margin:0"><input type="checkbox" id="s_pub" ${subject.published ? 'checked' : ''}> Publicada (visible para estudiantes matriculados)</label>
          <span class="grow"></span>
          <button class="btn" id="s_save">Guardar</button>
          <button class="btn danger" id="s_del">Eliminar materia</button>
        </div>
      </div>
      <div class="row sb" style="margin-bottom:.8rem"><h2 style="margin:0">Capítulos</h2><button class="btn" id="addch">+ Nuevo capítulo</button></div>
      ${chapters.map((c, ci) => {
        const mods = modules.filter((m) => m.chapter_id === c.id).sort(byPos);
        const quiz = quizzes.find((z) => z.chapter_id === c.id);
        return `<section class="card chapter">
          <header class="row"><h3 class="grow" style="margin:0">Capítulo ${ci + 1}: ${esc(c.title)}</h3>
            <button class="btn ghost sm" data-chup="${ci}">↑</button><button class="btn ghost sm" data-chdown="${ci}">↓</button>
            <button class="btn ghost sm" data-chren="${c.id}" data-t="${esc(c.title)}">Renombrar</button>
            <button class="btn danger sm" data-chdel="${c.id}">Eliminar</button></header>
          ${mods.map((m, mi) => `<div class="item"><span class="ic">${mi + 1}</span>
            <div class="grow"><b>${esc(m.title)}</b> <span class="muted small">· ${m.slide_count} diapositivas</span></div>
            <button class="btn ghost sm" data-mup="${c.id}:${mi}">↑</button><button class="btn ghost sm" data-mdown="${c.id}:${mi}">↓</button>
            <a class="btn ghost sm" href="#/m/${m.id}">Ver</a>
            <button class="btn ghost sm" data-mren="${m.id}" data-t="${esc(m.title)}">Renombrar</button>
            <button class="btn ghost sm" data-mrepl="${m.id}" data-ch="${c.id}">Reemplazar PPT</button>
            <button class="btn danger sm" data-mdel="${m.id}">Eliminar</button></div>`).join('') || '<div class="item muted">Sin módulos. Sube un PowerPoint para crear el primero.</div>'}
          <div class="item"><button class="btn sm" data-upload="${c.id}">⬆ Subir PowerPoint (.pptx)</button><span class="muted small">Cada archivo se convierte en un módulo.</span></div>
          <div class="item quiz"><span class="ic">?</span><div class="grow"><b>Quiz del capítulo</b> <span class="muted small">· ${quiz ? (qCounts[quiz.id] || 0) + ((qCounts[quiz.id] || 0) === 1 ? ' pregunta' : ' preguntas') : 'sin crear'}</span></div>
            <a class="btn sm" href="#/admin/q/${c.id}">${quiz ? 'Editar quiz' : 'Crear quiz'}</a></div>
        </section>`;
      }).join('') || '<div class="card muted">Agrega el primer capítulo.</div>'}
      <input type="file" id="file" accept=".pptx" multiple hidden>
    </div>`;

    $('#s_save').onclick = async () => {
      await q(sb.from('subjects').update({ title: $('#s_title').value.trim() || subject.title, description: $('#s_desc').value, published: $('#s_pub').checked }).eq('id', id));
      toast('Guardado'); route();
    };
    $('#s_del').onclick = async () => {
      if (!confirm(`¿Eliminar la materia "${subject.title}" con todos sus capítulos, módulos y quices? No se puede deshacer.`)) return;
      await q(sb.from('subjects').delete().eq('id', id)); location.hash = '#/admin';
    };
    $('#addch').onclick = async () => {
      const title = prompt('Nombre del capítulo:'); if (!title) return;
      await q(sb.from('chapters').insert({ subject_id: id, title, position: chapters.length })); route();
    };
    on('[data-chup]', 'click', async (b) => { await reorder('chapters', chapters, +b.dataset.chup, -1); route(); });
    on('[data-chdown]', 'click', async (b) => { await reorder('chapters', chapters, +b.dataset.chdown, 1); route(); });
    on('[data-chren]', 'click', async (b) => { const t = prompt('Nuevo nombre:', b.dataset.t); if (!t) return; await q(sb.from('chapters').update({ title: t }).eq('id', b.dataset.chren)); route(); });
    on('[data-chdel]', 'click', async (b) => {
      if (!confirm('¿Eliminar este capítulo con sus módulos y quiz?')) return;
      const mods = modules.filter((m) => m.chapter_id === b.dataset.chdel);
      for (const m of mods) await removeMedia(m.id);
      await q(sb.from('chapters').delete().eq('id', b.dataset.chdel)); route();
    });
    const modList = (cid) => modules.filter((m) => m.chapter_id === cid).sort(byPos);
    on('[data-mup]', 'click', async (b) => { const [c, i] = b.dataset.mup.split(':'); await reorder('modules', modList(c), +i, -1); route(); });
    on('[data-mdown]', 'click', async (b) => { const [c, i] = b.dataset.mdown.split(':'); await reorder('modules', modList(c), +i, 1); route(); });
    on('[data-mren]', 'click', async (b) => { const t = prompt('Nuevo nombre del módulo:', b.dataset.t); if (!t) return; await q(sb.from('modules').update({ title: t }).eq('id', b.dataset.mren)); route(); });
    on('[data-mdel]', 'click', async (b) => {
      if (!confirm('¿Eliminar este módulo?')) return;
      await removeMedia(b.dataset.mdel); await q(sb.from('modules').delete().eq('id', b.dataset.mdel)); route();
    });

    // subir / reemplazar PowerPoint
    const fileInput = $('#file'); let target = null;
    on('[data-upload]', 'click', (b) => { target = { chapterId: b.dataset.upload, replaceId: null }; fileInput.multiple = true; fileInput.click(); });
    on('[data-mrepl]', 'click', (b) => { target = { chapterId: b.dataset.ch, replaceId: b.dataset.mrepl }; fileInput.multiple = false; fileInput.click(); });
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files); fileInput.value = '';
      if (!files.length || !target) return;
      try {
        for (const f of files) await importPptx(target.chapterId, f, target.replaceId, modList(target.chapterId).length);
        toast('Listo ✓');
      } catch (e) { console.error(e); toast('No se pudo importar: ' + (e.message || e)); }
      busy(null); route();
    };
  }

  async function removeMedia(moduleId) {
    try {
      const { data } = await sb.storage.from('class-media').list(moduleId, { limit: 1000 });
      if (data && data.length) await sb.storage.from('class-media').remove(data.map((f) => `${moduleId}/${f.name}`));
    } catch (e) { /* no es crítico */ }
  }

  // Comprime imágenes pesadas (PNG/JPG grandes) a WebP y limita su ancho, para que las clases carguen rápido
  async function optimizeImage(blob, ext) {
    try {
      if (!['png', 'jpg', 'jpeg', 'bmp'].includes(ext) || blob.size < 120 * 1024 || !window.createImageBitmap) return { blob, ext };
      const bmp = await createImageBitmap(blob);
      const MAX = 2000;
      const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.86));
      if (out && out.type === 'image/webp' && out.size < blob.size * 0.9) return { blob: out, ext: 'webp' };
    } catch (e) { /* si falla, se sube el original */ }
    return { blob, ext };
  }

  async function importPptx(chapterId, file, replaceId, nextPos) {
    if (!/\.pptx$/i.test(file.name)) throw new Error(`"${file.name}" no es .pptx (guarda el .ppt antiguo como .pptx primero)`);
    const modId = replaceId || crypto.randomUUID();
    busy(`Convirtiendo "${file.name}"…`);
    const res = await PptxConverter.convert(file, {
      onProgress: (i, n) => busyMsg(`"${file.name}": diapositiva ${Math.min(i + 1, n)} de ${n}…`),
      onImage: async (blob0, ext0) => {
        const { blob, ext } = await optimizeImage(blob0, ext0);
        const path = `${modId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from('class-media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
        if (error) throw error;
        return sb.storage.from('class-media').getPublicUrl(path).data.publicUrl;
      }
    });
    const withNotes = res.slides.filter((s) => s.notes).length;
    if (withNotes && !confirm(`"${file.name}" tiene notas en ${withNotes} diapositivas.\n\n¿Mostrarlas a los estudiantes como material complementario?\n\nAceptar = mostrar · Cancelar = no incluirlas`)) res.slides.forEach((s) => { delete s.notes; });
    busyMsg('Guardando…');
    const row = { slides: res.slides, slide_w: Math.round(res.width), slide_h: Math.round(res.height), slide_count: res.slides.length };
    if (replaceId) {
      await q(sb.from('modules').update(row).eq('id', replaceId));
    } else {
      await q(sb.from('modules').insert(Object.assign({ id: modId, chapter_id: chapterId, title: file.name.replace(/\.pptx$/i, ''), position: nextPos }, row)));
    }
  }


  // ---------- generación de quices con IA ----------
  function slideContent(mods) {
    // Devuelve { text, images } con el texto de las diapositivas y las imágenes de las que casi no tienen texto
    const parser = new DOMParser();
    let text = ''; const images = [];
    mods.sort(byPos).forEach((m) => {
      text += `\n## Módulo: ${m.title}\n`;
      (m.slides || []).forEach((sl, i) => {
        const doc = parser.parseFromString(sl.html || '', 'text/html');
        const t = (doc.body.textContent || '').replace(/\s+/g, ' ').replace(/Profesor:[^.]{0,60}$/i, '').trim();
        if (t) text += `[Diapositiva ${i + 1}] ${t}\n`;
        if (sl.notes) text += `[Notas de la diapositiva ${i + 1}] ${sl.notes.replace(/\s+/g, ' ').slice(0, 1500)}\n`;
        if (t.length < 80) {
          const urls = Array.from(doc.querySelectorAll('img')).map((x) => x.getAttribute('src'));
          (sl.html.match(/url\('([^']+)'\)/g) || []).forEach((u) => urls.push(u.slice(5, -2)));
          urls.forEach((u) => { if (/^https:\/\//.test(u) && !images.includes(u)) images.push(u); });
        }
      });
    });
    return { text: text.slice(0, 60000), images: images.slice(0, 20) };
  }

  function normalizeQuestions(raw) {
    let arr = raw;
    if (arr && !Array.isArray(arr)) arr = arr.questions || arr.preguntas || [];
    if (!Array.isArray(arr)) throw new Error('El texto no es una lista de preguntas');
    const L = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5 };
    const out = arr.map((q) => {
      const options = (q.options || q.opciones || []).map((o) => String(o).replace(/^[A-Fa-f][).]\s+/, '').trim()).filter(Boolean);
      let c = q.correct != null ? q.correct : (q.correcta != null ? q.correcta : q.respuesta);
      if (typeof c === 'string') c = /^[a-f]$/i.test(c.trim()) ? L[c.trim().toLowerCase()] : parseInt(c, 10);
      return { question: String(q.question || q.pregunta || '').trim(), options: options.slice(0, 6), correct: Number.isInteger(c) ? c : 0, explanation: String(q.explanation || q.explicacion || q['explicación'] || '').trim() };
    }).filter((q) => q.question && q.options.length >= 2 && q.correct >= 0 && q.correct < q.options.length);
    if (!out.length) throw new Error('No se encontraron preguntas válidas');
    return out;
  }

  function buildPrompt(n, content) {
    return `Eres un profesor experto en ingeniería. Con el material de clase que aparece al final (texto de las diapositivas; si algunas diapositivas son imágenes, usa también los PowerPoint adjuntos), crea un quiz de ${n} preguntas de opción múltiple EN ESPAÑOL.

Reglas:
- Evalúa comprensión de conceptos, normas, datos y relaciones; no preguntes por el diseño de las diapositivas ni por el profesor.
- Usa SOLO información del material.
- Cada pregunta: 4 opciones, exactamente una correcta; las incorrectas plausibles; varía la posición de la correcta.
- Incluye una explicación breve (1-2 frases).
- Responde ÚNICAMENTE con un arreglo JSON, sin texto adicional, con este formato ("correct" es el índice 0-3 de la opción correcta):
[{"question":"...","options":["...","...","...","..."],"correct":0,"explanation":"..."}]

=== MATERIAL ===
${content}`;
  }

  function textModal(title, hint) {
    return new Promise((resolve) => {
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal" style="max-width:640px"><h3>${esc(title)}</h3><p class="small muted">${esc(hint)}</p>
        <textarea id="mt" rows="12" style="font-family:monospace;font-size:.85rem"></textarea>
        <div class="row" style="margin-top:.8rem;justify-content:flex-end"><button class="btn ghost" id="mc">Cancelar</button><button class="btn" id="mo">Importar</button></div></div>`;
      document.body.appendChild(bg);
      bg.querySelector('#mc').onclick = () => { bg.remove(); resolve(null); };
      bg.querySelector('#mo').onclick = () => { const v = bg.querySelector('#mt').value; bg.remove(); resolve(v); };
    });
  }

  // ---------- editor de quiz ----------
  async function quizEditor(chapterId) {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'admin');
    const chapter = await q(sb.from('chapters').select('*').eq('id', chapterId).single());
    const subject = await q(sb.from('subjects').select('id,title').eq('id', chapter.subject_id).single());
    let quiz = await q(sb.from('quizzes').select('*').eq('chapter_id', chapterId).maybeSingle());
    let qs = quiz ? (await q(sb.from('quiz_questions').select('*').eq('quiz_id', quiz.id))).sort(byPos) : [];
    const st = {
      title: quiz ? quiz.title : 'Quiz: ' + chapter.title,
      pass: quiz ? quiz.pass_score : 70,
      n: 10,
      qs: qs.map((x) => ({ question: x.question, options: [...(x.options || [])], correct: x.correct, explanation: x.explanation || '' }))
    };
    if (!st.qs.length) st.qs.push(blankQ());
    function blankQ() { return { question: '', options: ['', '', '', ''], correct: 0, explanation: '' }; }

    function render() {
      $('#page').innerHTML = `<div class="wrap">
        <div class="crumbs"><a href="#/admin">Administración</a> › <a href="#/admin/s/${subject.id}">${esc(subject.title)}</a> › Quiz</div>
        <h1>Quiz del capítulo: ${esc(chapter.title)}</h1>
        <div class="card"><div class="row"><div class="grow"><label style="margin-top:0">Título del quiz</label><input id="qt" value="${esc(st.title)}"></div>
          <div style="width:170px"><label style="margin-top:0">Nota mínima (%)</label><input id="qp" type="number" min="0" max="100" value="${st.pass}"></div></div></div>
        <div class="card" style="border-left:5px solid #7a4fd1">
          <h3 style="margin-bottom:.2rem">✨ Generar preguntas con IA</h3>
          <p class="small muted" style="margin-top:0">Usa el contenido de todos los módulos de este capítulo. Siempre revisa y corrige las preguntas antes de guardar.</p>
          <div class="row"><div style="width:120px"><label style="margin-top:0">Cantidad</label><input id="ain" type="number" min="3" max="30" value="${st.n}"></div>
            <button class="btn" id="aigen" style="align-self:flex-end">Generar automáticamente</button>
            <button class="btn ghost" id="aicopy" style="align-self:flex-end">Copiar prompt para Claude</button>
            <button class="btn ghost" id="aiimp" style="align-self:flex-end">Importar preguntas (JSON)</button></div>
        </div>
        ${st.qs.map((x, i) => `<div class="qedit">
          <div class="row sb"><b>Pregunta ${i + 1}</b><span class="row"><button class="btn ghost sm" data-qup="${i}">↑</button><button class="btn ghost sm" data-qdown="${i}">↓</button><button class="btn danger sm" data-qdel="${i}">Quitar</button></span></div>
          <textarea rows="2" data-qi="${i}" data-f="question" placeholder="Escribe la pregunta">${esc(x.question)}</textarea>
          <label>Opciones (marca la correcta)</label>
          ${x.options.map((o, oi) => `<div class="optrow"><input type="radio" name="c${i}" ${x.correct === oi ? 'checked' : ''} data-qi="${i}" data-correct="${oi}">
            <input data-qi="${i}" data-oi="${oi}" value="${esc(o)}" placeholder="Opción ${oi + 1}">
            ${x.options.length > 2 ? `<button class="btn ghost sm" data-odel="${i}:${oi}">✕</button>` : ''}</div>`).join('')}
          ${x.options.length < 6 ? `<button class="btn ghost sm" data-oadd="${i}">+ opción</button>` : ''}
          <label>Explicación (se muestra al corregir, opcional)</label><input data-qi="${i}" data-f="explanation" value="${esc(x.explanation)}">
        </div>`).join('')}
        <div class="row"><button class="btn ghost" id="addq">+ Agregar pregunta</button><span class="grow"></span>
          ${quiz ? '<button class="btn danger" id="delquiz">Eliminar quiz</button>' : ''}<button class="btn" id="save">Guardar quiz</button></div>
      </div>`;
      $('#qt').oninput = (e) => { st.title = e.target.value; };
      $('#qp').oninput = (e) => { st.pass = Math.max(0, Math.min(100, +e.target.value || 0)); };
      on('textarea[data-f],input[data-f]', 'input', (el) => { st.qs[+el.dataset.qi][el.dataset.f] = el.value; });
      on('input[data-oi]', 'input', (el) => { st.qs[+el.dataset.qi].options[+el.dataset.oi] = el.value; });
      on('input[data-correct]', 'change', (el) => { st.qs[+el.dataset.qi].correct = +el.dataset.correct; });
      on('[data-oadd]', 'click', (b) => { st.qs[+b.dataset.oadd].options.push(''); render(); });
      on('[data-odel]', 'click', (b) => { const [i, oi] = b.dataset.odel.split(':').map(Number); const x = st.qs[i]; x.options.splice(oi, 1); if (x.correct >= x.options.length) x.correct = 0; else if (oi < x.correct) x.correct--; render(); });
      on('[data-qdel]', 'click', (b) => { st.qs.splice(+b.dataset.qdel, 1); if (!st.qs.length) st.qs.push(blankQ()); render(); });
      on('[data-qup]', 'click', (b) => { const i = +b.dataset.qup; if (i > 0) { [st.qs[i - 1], st.qs[i]] = [st.qs[i], st.qs[i - 1]]; render(); } });
      on('[data-qdown]', 'click', (b) => { const i = +b.dataset.qdown; if (i < st.qs.length - 1) { [st.qs[i + 1], st.qs[i]] = [st.qs[i], st.qs[i + 1]]; render(); } });
      $('#addq').onclick = () => { st.qs.push(blankQ()); render(); window.scrollTo(0, document.body.scrollHeight); };
      if ($('#delquiz')) $('#delquiz').onclick = async () => {
        if (!confirm('¿Eliminar el quiz y todas sus notas?')) return;
        await q(sb.from('quizzes').delete().eq('id', quiz.id)); location.hash = '#/admin/s/' + subject.id;
      };
      $('#save').onclick = save;
      $('#ain').oninput = (e) => { st.n = Math.max(3, Math.min(30, +e.target.value || 10)); };

      const addQs = (nq) => {
        const onlyBlank = st.qs.length === 1 && !st.qs[0].question.trim();
        if (onlyBlank) st.qs = nq;
        else if (confirm(`Se generaron ${nq.length} preguntas.\n\nAceptar = REEMPLAZAR las preguntas actuales.\nCancelar = AGREGARLAS al final.`)) st.qs = nq;
        else st.qs = st.qs.concat(nq);
        render(); toast(`${nq.length} preguntas cargadas. Revísalas y pulsa Guardar quiz.`);
      };
      const loadContent = async () => {
        const mods = await q(sb.from('modules').select('title,position,slides').eq('chapter_id', chapterId));
        if (!mods.length) throw new Error('Este capítulo aún no tiene módulos');
        return slideContent(mods);
      };
      $('#aigen').onclick = async () => {
        try {
          busy('Leyendo el contenido y generando preguntas con IA… (puede tardar hasta un minuto)');
          const c = await loadContent();
          const { data: { session } } = await sb.auth.getSession();
          const r = await fetch('/.netlify/functions/generate-quiz', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ count: st.n, text: c.text, images: c.images })
          });
          let body = {}; try { body = await r.json(); } catch (e) { /* respuesta no JSON */ }
          if (!r.ok) throw new Error(body.error || (r.status === 404 ? 'La función no está publicada en Netlify (revisa el README, sección Quices con IA).' : 'Error ' + r.status));
          busy(null); addQs(normalizeQuestions(body.questions));
        } catch (e) { busy(null); toast('No se pudo generar: ' + e.message); }
      };
      $('#aicopy').onclick = async () => {
        try {
          const c = await loadContent();
          const prompt = buildPrompt(st.n, c.text);
          await navigator.clipboard.writeText(prompt);
          toast(c.images.length ? 'Prompt copiado. Algunas diapositivas son imágenes: adjunta también el .pptx en el chat de Claude.' : 'Prompt copiado. Pégalo en un chat con Claude.');
        } catch (e) { toast('No se pudo copiar: ' + e.message); }
      };
      $('#aiimp').onclick = async () => {
        const v = await textModal('Importar preguntas', 'Pega aquí el arreglo JSON que te dio Claude.');
        if (!v) return;
        try {
          const m = v.match(/\[[\s\S]*\]/);
          addQs(normalizeQuestions(JSON.parse(m ? m[0] : v)));
        } catch (e) { toast('No se pudo importar: ' + e.message); }
      };
    }

    async function save() {
      const valid = st.qs.filter((x) => x.question.trim() && x.options.filter((o) => o.trim()).length >= 2);
      if (!valid.length) { toast('Agrega al menos una pregunta con 2 opciones.'); return; }
      const clean = valid.map((x, i) => {
        const opts = []; let correct = 0;
        x.options.forEach((o, oi) => { if (o.trim()) { if (oi === x.correct) correct = opts.length; opts.push(o.trim()); } });
        return { position: i, question: x.question.trim(), options: opts, correct, explanation: x.explanation.trim() };
      });
      if (!quiz) quiz = await q(sb.from('quizzes').insert({ chapter_id: chapterId, title: st.title || 'Quiz', pass_score: st.pass }).select().single());
      else await q(sb.from('quizzes').update({ title: st.title || 'Quiz', pass_score: st.pass }).eq('id', quiz.id));
      await q(sb.from('quiz_questions').delete().eq('quiz_id', quiz.id));
      await q(sb.from('quiz_questions').insert(clean.map((c) => Object.assign({ quiz_id: quiz.id }, c))));
      toast('Quiz guardado ✓');
      location.hash = '#/admin/s/' + subject.id;
    }
    render();
  }

  // ---------- estudiantes y notas ----------
  async function adminStudents() {
    shell('<div class="wrap"><p class="loading">Cargando…</p></div>', 'admin');
    const [students, subjects, enr, attempts] = await Promise.all([
      q(sb.from('profiles').select('*').eq('role', 'student').order('created_at', { ascending: false })),
      q(sb.from('subjects').select('id,title,position')),
      q(sb.from('enrollments').select('*')),
      q(sb.from('quiz_attempts').select('*, profiles(full_name,email), quizzes(title, chapters(title, subjects(title)))').order('created_at', { ascending: false }).limit(150))
    ]);
    subjects.sort(byPos);
    const has = new Set(enr.map((e) => e.student_id + '|' + e.subject_id));
    $('#page').innerHTML = `<div class="wrap">${adminTabs('students')}
      <h1>Estudiantes</h1>
      <p class="muted small">Los estudiantes se registran solos desde la pantalla de inicio; aquí marcas a qué materias tienen acceso (solo se ven las materias publicadas).</p>
      <div class="card" style="overflow:auto">
      ${students.length && subjects.length ? `<table class="t"><thead><tr><th>Estudiante</th>${subjects.map((s) => `<th>${esc(s.title)}</th>`).join('')}</tr></thead><tbody>
        ${students.map((st) => `<tr><td><b>${esc(st.full_name || '(sin nombre)')}</b><br><span class="muted small">${esc(st.email)}</span></td>
          ${subjects.map((s) => `<td><input type="checkbox" data-st="${st.id}" data-su="${s.id}" ${has.has(st.id + '|' + s.id) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aún no hay estudiantes registrados o no has creado materias.</p>'}
      </div>
      <h2 style="margin-top:2rem">Últimas notas de quices</h2>
      <div class="card" style="overflow:auto">
      ${attempts.length ? `<table class="t"><thead><tr><th>Fecha</th><th>Estudiante</th><th>Materia / Capítulo</th><th>Nota</th></tr></thead><tbody>
        ${attempts.map((a) => { const pct = Math.round(a.score / a.total * 100); const ch = a.quizzes && a.quizzes.chapters;
          return `<tr><td>${fmtDate(a.created_at)}</td><td>${esc(a.profiles ? (a.profiles.full_name || a.profiles.email) : '')}</td>
          <td>${esc(ch && ch.subjects ? ch.subjects.title : '')} › ${esc(ch ? ch.title : '')}</td><td><b>${pct}%</b> <span class="muted small">(${a.score}/${a.total})</span></td></tr>`; }).join('')}
      </tbody></table>` : '<p class="muted">Todavía no hay intentos.</p>'}
      </div></div>`;
    on('input[data-st]', 'change', async (cb) => {
      const row = { student_id: cb.dataset.st, subject_id: cb.dataset.su };
      try {
        if (cb.checked) await q(sb.from('enrollments').insert(row));
        else await q(sb.from('enrollments').delete().eq('student_id', row.student_id).eq('subject_id', row.subject_id));
        toast(cb.checked ? 'Acceso otorgado' : 'Acceso retirado');
      } catch (e) { cb.checked = !cb.checked; }
    });
  }

  // ---------- inicio ----------
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session) { me = null; loginView('login'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (me && me.id === session.user.id) return;
      await loadProfile(session.user);
      route();
    }
  });
})();
