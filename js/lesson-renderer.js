/* Renderizador de lecciones JSON (formato "aula-lesson v1").
   render(slide, meta, n) -> HTML de una diapositiva de 1280x720 px (clase .lsl).
   Tipos: cover, cards, numbered, compare, stats, process, formula, chart, rows, image. */
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tone = (t) => ({ ora: 'ora', wat: 'wat', grn: 'grn', red: 'red', sky: 'sky', navy: 'navy' }[t] || 'lig');
  const safeUrl = (u) => (/^(https:\/\/|data:image\/)/.test(u || '') ? esc(u) : '');

  function head(s, meta, n) {
    return `<div class="kick">${esc(s.kicker || '')}</div><h2 class="ttl">${esc(s.title || '')}</h2>`;
  }
  function foot(meta, n) {
    return `<div class="ft">${esc((meta && meta.footer) || '')}</div><div class="fn">${n || ''}</div>`;
  }
  function note(s) {
    if (!s.note) return '';
    const a = Array.isArray(s.note) ? s.note : [s.note];
    return `<div class="note ${s.noteTone === 'sky' ? 'nsky' : ''}"><b>${esc(a[0])}</b>${a[1] ? `<span>${esc(a[1])}</span>` : ''}</div>`;
  }
  function wrap(s, meta, n, inner) {
    return `<div class="lsl">${head(s, meta, n)}<div class="bd">${inner}${note(s)}</div>${foot(meta, n)}</div>`;
  }
  const badge = (b, t) => (b ? `<i class="bg ${t || ''}">${esc(b)}</i>` : '');

  const T = {
    section(s) {
      return `<div class="lsl sec"><div class="sk">${esc(s.kicker || '')}</div><h1>${esc(s.title || '')}</h1>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}</div>`;
    },
    table(s, meta, n) {
      const al = s.align || [];
      const cell = (v, i, t) => `<${t} class="${al[i] || (i ? 'r' : 'l')}">${esc(v)}</${t}>`;
      const rows = (s.rows || []).map((r) => `<tr>${r.map((v, i) => cell(v, i, 'td')).join('')}</tr>`).join('');
      const tot = (s.totals || []).map((r) => `<tr class="tt">${r.map((v, i) => cell(v, i, 'td')).join('')}</tr>`).join('');
      return wrap(s, meta, n, `<div class="tw"><table class="tb"><thead><tr>${(s.head || []).map((v, i) => cell(v, i, 'th')).join('')}</tr></thead><tbody>${rows}${tot}</tbody></table></div>`);
    },
    cover(s, meta) {
      const img = safeUrl(s.image), logo = safeUrl(s.logo), ban = safeUrl(s.banner);
      if (ban) return `<div class="lsl cover cb"><div class="bn" style="background-image:url('${ban}')"></div><div class="bt"><div class="ck">${esc(s.kicker || '')}</div><h1>${esc(s.title || '')}</h1><p class="cs">${esc(s.subtitle || '')}</p><p class="ca">${esc(s.author || '')}</p></div></div>`;
      return `<div class="lsl cover"><div class="cl">${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
        <div class="ck">${esc(s.kicker || '')}</div><h1>${esc(s.title || '')}</h1><p class="cs">${esc(s.subtitle || '')}</p><p class="ca">${esc(s.author || '')}</p></div>
        ${img ? `<div class="cr" style="background-image:url('${img}')"></div>` : ''}</div>`;
    },
    cards(s, meta, n) {
      const cols = s.cols || Math.min(3, (s.items || []).length || 1);
      const items = (s.items || []).map((it) => `<div class="cd ${tone(it.tone)}">
        <div class="ch">${badge(it.badge, it.badgeTone)}<b>${esc(it.head)}</b></div>${it.body ? `<p>${esc(it.body)}</p>` : ''}</div>`).join('');
      return wrap(s, meta, n, `<div class="gr c${cols}${s.compact ? ' cp' : ''}">${items}</div>`);
    },
    numbered(s, meta, n) {
      const intro = s.intro ? `<div class="cd lig intro"><b>${esc(s.intro.title || '')}</b>${(s.intro.lines || []).map((l) => `<p class="bl">${esc(l)}</p>`).join('')}</div>` : '';
      const rows = (s.items || []).map((it, i) => `<div class="nr"><i class="bg">${esc(it.badge || i + 1)}</i><p>${it.head ? `<b>${esc(it.head)}</b> ` : ''}${esc(it.body)}</p></div>`).join('');
      return wrap(s, meta, n, `${intro}<div class="nl">${rows}</div>`);
    },
    compare(s, meta, n) {
      const col = (c) => `<div class="cd ${tone(c.tone)} cmp"><h3 class="t-${tone(c.tone)}">${esc(c.title)}</h3>${(c.lines || []).map((l) =>
        typeof l === 'string' ? `<p class="ln">${esc(l)}</p>` :
        l.giant ? `<div class="giant">${esc(l.giant)}</div>` :
        l.bullet ? `<p class="ln bl">${esc(l.bullet)}</p>` :
        `<div class="sb"><small>${esc(l.small)}</small><b>${esc(l.big)}</b></div>`).join('')}</div>`;
      return wrap(s, meta, n, `<div class="gr c2">${col(s.left)}${col(s.right)}</div>`);
    },
    stats(s, meta, n) {
      const p = (c) => `<div class="cd ${tone(c.tone)} st"><small class="t-${tone(c.tone)}">${esc(c.label)}</small>
        <div class="bigrow"><b>${esc(c.big)}</b><span>${esc(c.side)}</span></div>
        ${(c.rows || []).map((r) => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
        <em>${esc(c.foot || '')}</em></div>`;
      return wrap(s, meta, n, `<div class="gr c2">${(s.panels || []).map(p).join('')}</div>`);
    },
    process(s, meta, n) {
      const parts = [];
      (s.steps || []).forEach((st, i) => {
        if (i) parts.push('<div class="ar">➜</div>');
        parts.push(`<div class="cd ${tone(st.tone)} ps">${st.badge ? badge(st.badge, st.badgeTone) : ''}<b>${esc(st.head)}</b>${(st.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}</div>`);
      });
      return wrap(s, meta, n, `<div class="pr">${parts.join('')}</div>`);
    },
    formula(s, meta, n) {
      return wrap(s, meta, n, `<div class="cd ${tone(s.tone)} fm">${(Array.isArray(s.formula) ? s.formula : [s.formula]).map((f) => `<b class="t-${tone(s.tone)}${Array.isArray(s.formula) ? ' mf' : ''}">${esc(f)}</b>`).join('')}</div>
        <div class="gr c3 vars">${(s.vars || []).map((v) => `<div class="cd lig"><b>${esc(v[0])}</b><small>${esc(v[1])}</small></div>`).join('')}</div>`);
    },
    rows(s, meta, n) {
      return wrap(s, meta, n, `<div class="rw">${(s.rows || []).map((r) => `<div class="cd ${tone(r.tone)}"><b>${esc(r.label)}</b><span>${esc(r.expr)}</span><i>${esc(r.eq || '=')}</i><strong>${esc(r.value)}</strong></div>`).join('')}</div>`);
    },
    chart(s, meta, n) {
      const cats = s.cats || [], ser = s.series || [];
      const all = ser.flatMap((x) => x.values), mx = Math.max(0, ...all), mn = Math.min(0, ...all);
      const W = 740, H = 440, L = 54, B = 100, Tp = 40, ph = H - B - Tp, pw = W - L - 10;
      const rng = (mx - mn) || 1, y = (v) => Tp + ph * (1 - (v - mn) / rng), y0 = y(0);
      const step = Math.pow(10, Math.floor(Math.log10(rng))) * (rng / Math.pow(10, Math.floor(Math.log10(rng))) > 5 ? 2 : 1) ;
      let grid = '';
      for (let v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) grid += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#D5DDE6"/><text x="${L - 8}" y="${y(v) + 5}" text-anchor="end" class="ax">${Math.round(v)}</text>`;
      const gw = pw / cats.length, bw = Math.min(110, gw / (ser.length + 1));
      let bars = '';
      cats.forEach((c, i) => {
        const gx = L + gw * i + gw / 2 - (bw * ser.length) / 2;
        ser.forEach((sr, j) => {
          const v = sr.values[i], top = Math.min(y(v), y0), h = Math.abs(y(v) - y0), x = gx + j * bw;
          const col = { ora: '#D9650F', wat: '#0F6FBF', grn: '#1B8A4B' }[sr.tone] || '#0F6FBF';
          bars += `<rect x="${x + 4}" y="${top}" width="${bw - 8}" height="${h}" fill="${col}"/><text x="${x + bw / 2}" y="${v >= 0 ? top - 8 : top + h + 22}" text-anchor="middle" class="vl">${esc(String(v).replace('.', ','))}</text>`;
        });
        (String(c).split('\n')).forEach((ln, k) => { bars += `<text x="${L + gw * i + gw / 2}" y="${H - B + 56 + k * 24}" text-anchor="middle" class="ax2">${esc(ln)}</text>`; });
      });
      const leg = ser.map((sr, j) => `<span><i style="background:${{ ora: '#D9650F', wat: '#0F6FBF', grn: '#1B8A4B' }[sr.tone] || '#0F6FBF'}"></i>${esc(sr.name)}</span>`).join('');
      const aside = s.aside ? `<div class="cd lig as"><b>${esc(s.aside.title || '')}</b>${(s.aside.lines || []).map((l) => `<p class="bl">${esc(l)}</p>`).join('')}</div>` : '';
      return wrap(s, meta, n, `<div class="chw"><div class="cht"><div class="chn">${esc(s.chartTitle || '')}</div>
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${grid}<line x1="${L}" x2="${W}" y1="${y0}" y2="${y0}" stroke="#16202B"/>${bars}</svg><div class="lg">${leg}</div></div>${aside}</div>`);
    },
    image(s) {
      const u = safeUrl(s.image);
      return `<div class="lsl img">${u ? `<img src="${u}" alt="${esc(s.alt || s.title || '')}">` : ''}</div>`;
    }
  };

  function render(slide, meta, n) {
    const f = T[slide.type] || T.cards;
    return f(slide, meta || {}, n);
  }
  // Texto plano de una diapositiva (para generar quices con IA)
  function plainText(slide) {
    const out = [];
    (function walk(v, k) {
      if (v == null) return;
      if (typeof v === 'string') { if (!['type', 'tone', 'image', 'logo', 'badgeTone', 'noteTone'].includes(k)) out.push(v); }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
      else if (typeof v === 'object') Object.keys(v).forEach((kk) => { if (kk !== 'notes') walk(v[kk], kk); });
    })(slide);
    return out.join(' · ');
  }
  const api = { render, plainText, W: 1280, H: 720 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LessonRenderer = api;
})(typeof window !== 'undefined' ? window : this);
