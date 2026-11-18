/* =====================================================================
   Conversor PowerPoint (.pptx) → HTML, 100% en el navegador.
   Uso:
     const res = await PptxConverter.convert(file, { onImage: async (blob, ext) => url });
     res = { width, height, slides: [{ title, html }] }
   Requiere JSZip (window.JSZip). Soporta: texto con formato, viñetas,
   formas con relleno/borde, imágenes (con recorte), grupos, tablas, fondos,
   y elementos del diseño/patrón (logos, barras decorativas).
   ===================================================================== */
(function (global) {
  'use strict';

  const EMU = 9525; // 1 px = 9525 EMU (96 dpi)
  const px = (emu) => Math.round((emu / EMU) * 100) / 100;

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- utilidades DOM (por localName, sin depender de prefijos) ----------
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const kid = (el, ...path) => {
    let cur = el;
    for (const n of path) { if (!cur) return null; cur = kids(cur, n)[0] || null; }
    return cur;
  };
  const at = (el, n) => (el ? el.getAttribute(n) : null);
  const num = (el, n, d) => { const v = at(el, n); return v === null || v === '' || isNaN(+v) ? d : +v; };

  const parseXml = (txt) => new DOMParser().parseFromString(txt, 'application/xml');

  // ---------- colores ----------
  const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080' };

  function hexToRgb(h) { return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s; const l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; } else {
      const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // node = <a:solidFill> (o cualquier elemento cuyo primer hijo sea el color)
  function colorOf(node, ctx) {
    const c = node && node.firstElementChild;
    if (!c) return null;
    let hex = null;
    const n = c.localName;
    if (n === 'srgbClr') hex = at(c, 'val');
    else if (n === 'schemeClr') {
      let v = at(c, 'val');
      if (v === 'phClr') return ctx.phColor || null;
      v = ctx.clrMap[v] || v;
      hex = ctx.theme[v] || null;
    } else if (n === 'sysClr') hex = at(c, 'lastClr') || (at(c, 'val') === 'window' ? 'FFFFFF' : '000000');
    else if (n === 'prstClr') hex = PRESET[at(c, 'val')] || '000000';
    if (!hex) return null;
    let [r, g, b] = hexToRgb(hex);
    let alpha = 1;
    for (const m of Array.from(c.children)) {
      const v = num(m, 'val', 0) / 100000;
      if (m.localName === 'lumMod' || m.localName === 'lumOff' || m.localName === 'tint' || m.localName === 'shade') {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (m.localName === 'lumMod') l = Math.min(1, l * v);
        if (m.localName === 'lumOff') l = Math.min(1, l + v);
        if (m.localName === 'tint') l = Math.min(1, l + (1 - l) * (1 - v));
        if (m.localName === 'shade') l = l * v;
        [r, g, b] = hslToRgb(h, s, l);
      }
      if (m.localName === 'alpha') alpha = v;
    }
    return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
  }

  function fillCss(spPr, ctx) {
    // devuelve css de fondo ('' = nada definido, 'transparent' = sin relleno)
    if (!spPr) return '';
    if (kid(spPr, 'noFill')) return 'transparent';
    const solid = kid(spPr, 'solidFill');
    if (solid) { const c = colorOf(solid, ctx); return c ? c : ''; }
    const grad = kid(spPr, 'gradFill');
    if (grad) {
      const stops = kids(kid(grad, 'gsLst'), 'gs').map((gs) => colorOf(gs, ctx)).filter(Boolean);
      if (stops.length >= 2) {
        const ang = num(kid(grad, 'lin'), 'ang', 5400000) / 60000;
        return `linear-gradient(${ang + 90}deg, ${stops.join(',')})`;
      }
      if (stops.length === 1) return stops[0];
    }
    return '';
  }

  // ---------- rutas y relaciones ----------
  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  async function readRels(zip, partPath) {
    const dir = partPath.substring(0, partPath.lastIndexOf('/'));
    const name = partPath.substring(partPath.lastIndexOf('/') + 1);
    const f = zip.file(`${dir}/_rels/${name}.rels`);
    const map = {};
    if (!f) return map;
    const doc = parseXml(await f.async('string'));
    for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
      map[at(r, 'Id')] = { target: resolvePath(partPath, at(r, 'Target')), type: at(r, 'Type') };
    }
    return map;
  }

  // ---------- conversor principal ----------
  async function convert(file, opts) {
    opts = opts || {};
    if (!global.JSZip) throw new Error('JSZip no está cargado');
    const zip = await global.JSZip.loadAsync(file);

    const presFile = zip.file('ppt/presentation.xml');
    if (!presFile) throw new Error('El archivo no parece ser un .pptx válido');
    const presDoc = parseXml(await presFile.async('string'));
    const sz = presDoc.getElementsByTagNameNS('*', 'sldSz')[0];
    const W = num(sz, 'cx', 12192000), H = num(sz, 'cy', 6858000);
    const presRels = await readRels(zip, 'ppt/presentation.xml');

    const slidePaths = [];
    for (const s of Array.from(presDoc.getElementsByTagNameNS('*', 'sldId'))) {
      const rid = s.getAttribute('r:id');
      if (rid && presRels[rid]) slidePaths.push(presRels[rid].target);
    }
    if (!slidePaths.length) throw new Error('El PowerPoint no tiene diapositivas');

    // tema (colores y fuentes)
    const themeEntry = Object.values(presRels).find((r) => /theme$/.test(r.type));
    const themePath = themeEntry ? themeEntry.target : 'ppt/theme/theme1.xml';
    const theme = {}; const fonts = { major: null, minor: null };
    const tf = zip.file(themePath);
    if (tf) {
      const td = parseXml(await tf.async('string'));
      const cs = td.getElementsByTagNameNS('*', 'clrScheme')[0];
      for (const c of Array.from((cs && cs.children) || [])) {
        const inner = c.firstElementChild; if (!inner) continue;
        theme[c.localName] = inner.localName === 'srgbClr' ? at(inner, 'val') : (at(inner, 'lastClr') || '000000');
      }
      const mj = td.getElementsByTagNameNS('*', 'majorFont')[0], mn = td.getElementsByTagNameNS('*', 'minorFont')[0];
      fonts.major = at(kid(mj, 'latin'), 'typeface'); fonts.minor = at(kid(mn, 'latin'), 'typeface');
    }

    // cachés
    const partCache = {};
    async function loadPart(path) {
      if (partCache[path]) return partCache[path];
      const f = zip.file(path);
      if (!f) return null;
      const part = { path, doc: parseXml(await f.async('string')), rels: await readRels(zip, path) };
      partCache[path] = part; return part;
    }
    const mediaCache = {};
    async function mediaUrl(path) {
      if (path in mediaCache) return mediaCache[path];
      const f = zip.file(path);
      if (!f) return (mediaCache[path] = null);
      const ext = (path.split('.').pop() || '').toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return (mediaCache[path] = null);
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[ext] || `image/${ext}`;
      const blob = new Blob([await f.async('uint8array')], { type: mime });
      const url = opts.onImage ? await opts.onImage(blob, ext) : URL.createObjectURL(blob);
      return (mediaCache[path] = url);
    }

    const slides = [];
    for (let i = 0; i < slidePaths.length; i++) {
      if (opts.onProgress) opts.onProgress(i, slidePaths.length);
      const slide = await loadPart(slidePaths[i]);
      if (!slide) continue;
      const layoutRel = Object.values(slide.rels).find((r) => /slideLayout$/.test(r.type));
      const layout = layoutRel ? await loadPart(layoutRel.target) : null;
      const masterRel = layout ? Object.values(layout.rels).find((r) => /slideMaster$/.test(r.type)) : null;
      const master = masterRel ? await loadPart(masterRel.target) : null;

      const clrMapEl = master ? kid(master.doc.documentElement, 'clrMap') : null;
      const clrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      if (clrMapEl) for (const a of Array.from(clrMapEl.attributes)) clrMap[a.name] = a.value;
      // diapositiva puede sobrescribir (clrMapOvr/overrideClrMapping)
      const ovr = kid(slide.doc.documentElement, 'clrMapOvr', 'overrideClrMapping');
      if (ovr) for (const a of Array.from(ovr.attributes)) clrMap[a.name] = a.value;

      const ctx = { theme, clrMap, fonts, W, H, mediaUrl, slide, layout, master };
      slides.push(await renderSlide(ctx));
    }
    if (opts.onProgress) opts.onProgress(slidePaths.length, slidePaths.length);
    return { width: px(W), height: px(H), slides };
  }

  // ---------- diapositiva ----------
  async function renderSlide(ctx) {
    const { slide, layout, master } = ctx;
    const sRoot = slide.doc.documentElement;
    let bg = await backgroundCss(sRoot, slide, ctx);
    if (!bg && layout) bg = await backgroundCss(layout.doc.documentElement, layout, ctx);
    if (!bg && master) bg = await backgroundCss(master.doc.documentElement, master, ctx);
    if (!bg) bg = 'background:#fff;';

    let out = '';
    const showMaster = at(sRoot, 'showMasterSp') !== '0';
    const layoutShowMaster = layout ? at(layout.doc.documentElement, 'showMasterSp') !== '0' : true;
    if (master && showMaster && layoutShowMaster) out += await renderTree(kid(master.doc.documentElement, 'cSld', 'spTree'), master, ctx, { skipPlaceholders: true });
    if (layout && showMaster) out += await renderTree(kid(layout.doc.documentElement, 'cSld', 'spTree'), layout, ctx, { skipPlaceholders: true });
    const titleBox = { text: '' };
    out += await renderTree(kid(sRoot, 'cSld', 'spTree'), slide, ctx, { titleBox });

    const html = `<div class="sl" style="position:relative;overflow:hidden;width:${px(ctx.W)}px;height:${px(ctx.H)}px;${bg}">${out}</div>`;
    return { title: (titleBox.text || '').trim().slice(0, 140), html };
  }

  async function backgroundCss(root, part, ctx) {
    const bg = kid(root, 'cSld', 'bg');
    if (!bg) return '';
    const pr = kid(bg, 'bgPr');
    if (pr) {
      const f = fillCss(pr, ctx);
      if (f) return f.startsWith('linear') ? `background:${f};` : `background:${f};`;
      const blip = kid(pr, 'blipFill', 'blip');
      if (blip) {
        const rel = part.rels[at(blip, 'r:embed')];
        const url = rel ? await ctx.mediaUrl(rel.target) : null;
        if (url) return `background:url('${url}') center/cover no-repeat;`;
      }
    }
    const ref = kid(bg, 'bgRef');
    if (ref) { const c = colorOf(ref, ctx); if (c) return `background:${c};`; }
    return '';
  }

  // ---------- árbol de formas ----------
  const IDENT = { sx: 1, sy: 1, dx: 0, dy: 0 };

  async function renderTree(tree, part, ctx, o, T) {
    if (!tree) return '';
    T = T || IDENT; o = o || {};
    let out = '';
    for (const el of Array.from(tree.children)) {
      const n = el.localName;
      try {
        if (n === 'sp') out += await renderSp(el, part, ctx, o, T);
        else if (n === 'pic') out += await renderPic(el, part, ctx, T);
        else if (n === 'cxnSp') out += renderLine(el, ctx, T);
        else if (n === 'graphicFrame') out += renderFrame(el, part, ctx, T);
        else if (n === 'grpSp') {
          const x = kid(el, 'grpSpPr', 'xfrm');
          if (!x) { out += await renderTree(el, part, ctx, o, T); continue; }
          const off = kid(x, 'off'), ext = kid(x, 'ext'), cho = kid(x, 'chOff'), che = kid(x, 'chExt');
          const ox = num(off, 'x', 0) * T.sx + T.dx, oy = num(off, 'y', 0) * T.sy + T.dy;
          const ew = num(ext, 'cx', 1) * T.sx, eh = num(ext, 'cy', 1) * T.sy;
          const cw = num(che, 'cx', 0) || num(ext, 'cx', 1), ch = num(che, 'cy', 0) || num(ext, 'cy', 1);
          const sx = ew / cw, sy = eh / ch;
          const T2 = { sx, sy, dx: ox - num(cho, 'x', 0) * sx, dy: oy - num(cho, 'y', 0) * sy };
          out += await renderTree(el, part, ctx, o, T2);
        }
      } catch (e) { /* una forma rara no debe romper toda la diapositiva */ }
    }
    return out;
  }

  // ---------- herencia de placeholders ----------
  function placeholderOf(sp) { return kid(sp, 'nvSpPr', 'nvPr', 'ph'); }
  const isTitleType = (t) => t === 'title' || t === 'ctrTitle';

  function findPh(part, ph) {
    if (!part || !ph) return null;
    const tree = kid(part.doc.documentElement, 'cSld', 'spTree');
    const sps = kids(tree, 'sp');
    const t = at(ph, 'type'), idx = at(ph, 'idx');
    if (idx !== null) { for (const sp of sps) { const p = placeholderOf(sp); if (p && at(p, 'idx') === idx) return sp; } }
    for (const sp of sps) {
      const p = placeholderOf(sp); if (!p) continue;
      const pt = at(p, 'type');
      if (t && (pt === t || (isTitleType(t) && isTitleType(pt)))) return sp;
      if (!t && (pt === 'body' || !pt) && idx === null) return sp;
    }
    // cuerpo sin tipo conocido → body del patrón
    if (!t || t === 'body' || t === 'obj') for (const sp of sps) { const p = placeholderOf(sp); if (p && at(p, 'type') === 'body') return sp; }
    return null;
  }

  function getXfrm(sp, part, ctx) {
    let x = kid(sp, 'spPr', 'xfrm');
    if (x) return x;
    const ph = placeholderOf(sp);
    if (!ph) return null;
    if (part === ctx.slide) {
      const l = findPh(ctx.layout, ph); x = l && kid(l, 'spPr', 'xfrm'); if (x) return x;
      const m = findPh(ctx.master, ph); x = m && kid(m, 'spPr', 'xfrm'); if (x) return x;
    } else if (part === ctx.layout) {
      const m = findPh(ctx.master, ph); x = m && kid(m, 'spPr', 'xfrm'); if (x) return x;
    }
    return null;
  }

  function box(x, T) {
    const off = kid(x, 'off'), ext = kid(x, 'ext');
    const left = num(off, 'x', 0) * T.sx + T.dx, top = num(off, 'y', 0) * T.sy + T.dy;
    const w = num(ext, 'cx', 0) * T.sx, h = num(ext, 'cy', 0) * T.sy;
    const rot = num(x, 'rot', 0) / 60000;
    let css = `left:${px(left)}px;top:${px(top)}px;width:${px(w)}px;height:${px(h)}px;`;
    const tr = [];
    if (rot) tr.push(`rotate(${rot}deg)`);
    if (at(x, 'flipH') === '1') tr.push('scaleX(-1)');
    if (at(x, 'flipV') === '1') tr.push('scaleY(-1)');
    if (tr.length) css += `transform:${tr.join(' ')};`;
    return { css, w: px(w), h: px(h) };
  }

  // ---------- formas con texto ----------
  async function renderSp(sp, part, ctx, o, T) {
    const ph = placeholderOf(sp);
    if (o.skipPlaceholders && ph) return '';
    const x = getXfrm(sp, part, ctx);
    if (!x) return '';
    const b = box(x, T);
    const spPr = kid(sp, 'spPr');
    const style = kid(sp, 'style');
    const sctx = Object.assign({}, ctx);

    // relleno
    let bg = fillCss(spPr, ctx);
    if (!bg && !ph && style) {
      const fr = kid(style, 'fillRef');
      if (fr && num(fr, 'idx', 0) > 0) { const c = colorOf(fr, ctx); if (c) bg = c; }
    }
    let css = `position:absolute;${b.css}box-sizing:border-box;`;
    if (bg && bg !== 'transparent') css += `background:${bg};`;

    // borde
    const ln = kid(spPr, 'ln');
    let lineColor = null, lineW = 0;
    if (ln && !kid(ln, 'noFill')) {
      const sf = kid(ln, 'solidFill'); lineColor = sf ? colorOf(sf, ctx) : null; lineW = num(ln, 'w', 12700);
    } else if (!ln && style && !ph) {
      const lr = kid(style, 'lnRef');
      if (lr && num(lr, 'idx', 0) > 0) { lineColor = colorOf(lr, ctx); lineW = 12700; }
    }
    if (lineColor) {
      const dash = at(kid(ln, 'prstDash'), 'val');
      css += `border:${Math.max(1, px(lineW))}px ${dash && dash !== 'solid' ? 'dashed' : 'solid'} ${lineColor};`;
    }
    const prst = at(kid(spPr, 'prstGeom'), 'prst');
    if (prst === 'ellipse') css += 'border-radius:50%;';
    else if (prst === 'roundRect') css += `border-radius:${Math.round(Math.min(b.w, b.h) * 0.16)}px;`;

    // texto
    const txBody = kid(sp, 'txBody');
    let inner = '';
    if (txBody) {
      const fontRefColor = style ? colorOf(kid(style, 'fontRef'), ctx) : null;
      inner = renderText(txBody, sp, part, sctx, { fontRefColor, isPh: !!ph, phType: ph ? at(ph, 'type') : null, titleBox: o.titleBox, autoShape: !ph && !!style && !kid(sp, 'nvSpPr', 'cNvSpPr') .hasAttribute('txBox') });
    }
    if (!inner && !(bg && bg !== 'transparent') && !lineColor) return '';
    const bodyPr = kid(txBody, 'bodyPr');
    const l = num(bodyPr, 'lIns', 91440), t = num(bodyPr, 'tIns', 45720), r = num(bodyPr, 'rIns', 91440), bt = num(bodyPr, 'bIns', 45720);
    const anchor = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[at(bodyPr, 'anchor') || 't'] || 'flex-start';
    css += `display:flex;flex-direction:column;justify-content:${anchor};padding:${px(t)}px ${px(r)}px ${px(bt)}px ${px(l)}px;`;
    if (at(bodyPr, 'wrap') === 'none') css += 'white-space:nowrap;';
    return `<div style="${css}">${inner}</div>`;
  }

  function lvlNode(parent, lvl) { return parent ? kid(parent, `lvl${lvl + 1}pPr`) : null; }

  function renderText(txBody, sp, part, ctx, info) {
    const ph = placeholderOf(sp);
    const layoutSp = part === ctx.slide ? findPh(ctx.layout, ph) : null;
    const masterSp = part === ctx.slide || part === ctx.layout ? findPh(ctx.master, ph) : null;
    const txStyles = ctx.master ? kid(ctx.master.doc.documentElement, 'txStyles') : null;
    const phType = info.phType;
    const styleKey = !ph ? 'otherStyle' : (isTitleType(phType) ? 'titleStyle' : (['body', 'obj', null, undefined].includes(phType) || !phType ? 'bodyStyle' : 'otherStyle'));
    const mStyle = kid(txStyles, styleKey);
    const bodyPr = kid(txBody, 'bodyPr');
    const fit = kid(bodyPr, 'normAutofit');
    const fontScale = fit ? num(fit, 'fontScale', 100000) / 100000 : 1;

    const listStyles = [kid(txBody, 'lstStyle'), layoutSp && kid(layoutSp, 'txBody', 'lstStyle'), masterSp && kid(masterSp, 'txBody', 'lstStyle'), mStyle];
    const paras = kids(txBody, 'p');
    let html = '';
    const counters = {};
    let plain = '';

    for (const p of paras) {
      const pPr = kid(p, 'pPr');
      const lvl = Math.min(8, num(pPr, 'lvl', 0));
      const chain = [pPr].concat(listStyles.map((ls) => lvlNode(ls, lvl)));
      const pick = (fn) => { for (const n of chain) { if (!n) continue; const v = fn(n); if (v !== null && v !== undefined) return v; } return null; };
      const rChain = [null].concat(chain.map((n) => n && kid(n, 'defRPr')));

      const algn = pick((n) => at(n, 'algn')) || (info.autoShape ? 'ctr' : 'l');
      const marL = pick((n) => (at(n, 'marL') !== null ? num(n, 'marL', 0) : null)) || 0;
      const indent = pick((n) => (at(n, 'indent') !== null ? num(n, 'indent', 0) : null)) || 0;
      // viñetas
      let bullet = '';
      const buNone = pick((n) => (kid(n, 'buNone') ? true : null));
      const buChar = pick((n) => { const k = kid(n, 'buChar'); return k ? at(k, 'char') : null; });
      const buNum = pick((n) => { const k = kid(n, 'buAutoNum'); return k ? at(k, 'type') : null; });
      // ¿cuál aparece primero en la cadena? (buNone gana si está antes que las otras)
      let bulletKind = null;
      for (const n of chain) {
        if (!n) continue;
        if (kid(n, 'buNone')) { bulletKind = 'none'; break; }
        if (kid(n, 'buChar')) { bulletKind = 'char'; break; }
        if (kid(n, 'buAutoNum')) { bulletKind = 'num'; break; }
      }
      const lnPct = pick((n) => { const s = kid(n, 'lnSpc', 'spcPct'); return s ? num(s, 'val', 100000) / 100000 : null; });
      const spcBef = pick((n) => { const s = kid(n, 'spcBef', 'spcPts'); return s ? num(s, 'val', 0) / 100 : null; });
      const spcAft = pick((n) => { const s = kid(n, 'spcAft', 'spcPts'); return s ? num(s, 'val', 0) / 100 : null; });

      // runs
      let runs = '';
      let firstSizePt = null;
      for (const r of Array.from(p.children)) {
        if (r.localName === 'br') { runs += '<br>'; continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const t = kid(r, 't'); const text = t ? t.textContent : '';
        if (!text) continue;
        plain += text;
        const rPr = kid(r, 'rPr');
        const rc = [rPr].concat(rChain.slice(1));
        const rp = (fn) => { for (const n of rc) { if (!n) continue; const v = fn(n); if (v !== null && v !== undefined) return v; } return null; };
        let szv = rp((n) => (at(n, 'sz') !== null ? num(n, 'sz', 1800) : null));
        if (szv === null) szv = 1800;
        if (firstSizePt === null) firstSizePt = szv / 100;
        const sizePx = Math.round((szv / 100) * (96 / 72) * fontScale * 10) / 10;
        const bold = rp((n) => (at(n, 'b') !== null ? at(n, 'b') === '1' : null));
        const ital = rp((n) => (at(n, 'i') !== null ? at(n, 'i') === '1' : null));
        const und = rp((n) => (at(n, 'u') !== null ? at(n, 'u') !== 'none' : null));
        const strike = rp((n) => (at(n, 'strike') !== null ? at(n, 'strike') !== 'noStrike' : null));
        const base = rp((n) => (at(n, 'baseline') !== null ? num(n, 'baseline', 0) : null)) || 0;
        const col = rp((n) => { const sf = kid(n, 'solidFill'); return sf ? colorOf(sf, ctx) : null; }) || info.fontRefColor || colorOf({ firstElementChild: { localName: 'schemeClr', getAttribute: () => 'tx1', children: [] } }, ctx) || '#000';
        let face = rp((n) => { const l = kid(n, 'latin'); return l ? at(l, 'typeface') : null; });
        if (face === '+mj-lt') face = ctx.fonts.major; else if (face === '+mn-lt' || !face) face = face ? ctx.fonts.minor : (isTitleType(phType) ? ctx.fonts.major : ctx.fonts.minor);
        const hl = rp((n) => { const h = kid(n, 'highlight'); return h ? colorOf(h, ctx) : null; });

        let s = `font-size:${sizePx}px;color:${col};`;
        if (bold) s += 'font-weight:700;';
        if (ital) s += 'font-style:italic;';
        if (und || strike) s += `text-decoration:${[und ? 'underline' : '', strike ? 'line-through' : ''].join(' ').trim()};`;
        if (face) s += `font-family:'${esc(face)}',Calibri,'Segoe UI',Arial,sans-serif;`;
        if (hl) s += `background:${hl};`;
        let txt = esc(text).replace(/\n/g, '<br>').replace(/\u000b/g, '<br>');
        if (base > 0) txt = `<sup>${txt}</sup>`; else if (base < 0) txt = `<sub>${txt}</sub>`;
        runs += `<span style="${s}">${txt}</span>`;
      }

      const sizePt = firstSizePt || (rChain.map((n) => n && at(n, 'sz')).find(Boolean) / 100) || 18;
      const empty = !runs;
      if (empty) {
        const endSz = at(kid(p, 'endParaRPr'), 'sz');
        const pt = endSz ? +endSz / 100 : sizePt;
        html += `<p style="margin:0;height:${Math.round(pt * (96 / 72) * 1.2 * fontScale)}px"></p>`;
        continue;
      }

      // viñeta
      let padLeft = px(marL), textIndent = 0, bulletHtml = '';
      const hasBullet = bulletKind === 'char' || bulletKind === 'num';
      if (hasBullet) {
        let sym = '';
        if (bulletKind === 'char') sym = esc(buChar || '•');
        else {
          counters[lvl] = (counters[lvl] || 0) + 1;
          for (const k of Object.keys(counters)) if (+k > lvl) counters[k] = 0;
          const typ = buNum || 'arabicPeriod';
          const nth = counters[lvl];
          sym = typ.startsWith('alphaLc') ? String.fromCharCode(96 + ((nth - 1) % 26) + 1) : typ.startsWith('alphaUc') ? String.fromCharCode(64 + ((nth - 1) % 26) + 1) : String(nth);
          sym += typ.includes('ParenR') ? ')' : typ.includes('Period') ? '.' : '';
        }
        if (bulletKind === 'char' && /[§ü¡Ø]/.test(sym)) sym = '•'; // símbolos Wingdings/Symbol
        const left = px(marL + indent);
        bulletHtml = `<span style="position:absolute;left:${Math.max(0, left)}px;top:0;font-size:${Math.round(sizePt * (96 / 72) * fontScale)}px">${sym}</span>`;
        if (!padLeft) padLeft = px(marL) || Math.round(sizePt * 1.3);
      } else {
        counters[lvl] = 0;
        textIndent = px(indent);
        if (marL === 0 && indent < 0) textIndent = 0;
      }
      let ps = `margin:0;position:relative;text-align:${{ l: 'left', ctr: 'center', r: 'right', just: 'justify' }[algn] || 'left'};`;
      if (padLeft) ps += `padding-left:${Math.max(0, padLeft)}px;`;
      if (textIndent && !hasBullet) ps += `text-indent:${textIndent}px;`;
      ps += `line-height:${lnPct ? Math.max(0.9, lnPct * 1.2).toFixed(2) : 1.2};`;
      if (spcBef) ps += `margin-top:${Math.round(spcBef * (96 / 72))}px;`;
      if (spcAft) ps += `margin-bottom:${Math.round(spcAft * (96 / 72))}px;`;
      html += `<p style="${ps}">${bulletHtml}${runs}</p>`;
    }
    if (info.titleBox && isTitleType(phType) && !info.titleBox.text) info.titleBox.text = plain;
    return html;
  }

  // ---------- líneas / conectores ----------
  function renderLine(el, ctx, T) {
    const x = kid(el, 'spPr', 'xfrm'); if (!x) return '';
    const b = box(x, T);
    const ln = kid(el, 'spPr', 'ln');
    let col = ln && kid(ln, 'solidFill') ? colorOf(kid(ln, 'solidFill'), ctx) : null;
    if (!col) { const lr = kid(el, 'style', 'lnRef'); col = lr ? colorOf(lr, ctx) : '#888'; }
    const w = Math.max(1, px(num(ln, 'w', 12700)));
    const ext = kid(x, 'ext');
    const horizontal = num(ext, 'cy', 0) < num(ext, 'cx', 0) * 0.02;
    const vertical = num(ext, 'cx', 0) < num(ext, 'cy', 0) * 0.02;
    if (horizontal) return `<div style="position:absolute;${b.css.replace(/height:[^;]+;/, `height:${w}px;`)}background:${col}"></div>`;
    if (vertical) return `<div style="position:absolute;${b.css.replace(/width:[^;]+;/, `width:${w}px;`)}background:${col}"></div>`;
    // diagonal → SVG
    const flipV = at(x, 'flipV') === '1', flipH = at(x, 'flipH') === '1';
    const [x1, x2] = flipH ? [b.w, 0] : [0, b.w], [y1, y2] = flipV ? [b.h, 0] : [0, b.h];
    return `<svg style="position:absolute;${b.css.replace(/transform:[^;]+;/, '')}overflow:visible" viewBox="0 0 ${b.w} ${b.h}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w}"/></svg>`;
  }

  // ---------- imágenes ----------
  async function renderPic(pic, part, ctx, T) {
    const x = kid(pic, 'spPr', 'xfrm'); if (!x) return '';
    const b = box(x, T);
    const blip = kid(pic, 'blipFill', 'blip');
    const rel = blip ? part.rels[at(blip, 'r:embed')] : null;
    const url = rel ? await ctx.mediaUrl(rel.target) : null;
    if (!url) return `<div style="position:absolute;${b.css}background:#eef1f4;border:1px dashed #b8c0c8"></div>`;
    const src = kid(pic, 'blipFill', 'srcRect');
    let l = num(src, 'l', 0) / 100000, t = num(src, 't', 0) / 100000, r = num(src, 'r', 0) / 100000, bt = num(src, 'b', 0) / 100000;
    const iw = b.w / Math.max(0.01, 1 - l - r), ih = b.h / Math.max(0.01, 1 - t - bt);
    const geom = at(kid(pic, 'spPr', 'prstGeom'), 'prst');
    const radius = geom === 'ellipse' ? 'border-radius:50%;' : '';
    return `<div style="position:absolute;${b.css}overflow:hidden;${radius}"><img src="${esc(url)}" alt="" style="position:absolute;left:${-l * iw}px;top:${-t * ih}px;width:${iw}px;height:${ih}px;max-width:none"></div>`;
  }

  // ---------- tablas y gráficos ----------
  function renderFrame(el, part, ctx, T) {
    const x = kid(el, 'xfrm'); if (!x) return '';
    const b = box(x, T);
    const tbl = el.getElementsByTagNameNS('*', 'tbl')[0];
    if (!tbl) return `<div style="position:absolute;${b.css}display:flex;align-items:center;justify-content:center;background:#f3f5f7;border:1px dashed #b8c0c8;color:#6b7785;font:14px sans-serif">Gráfico / objeto no convertible</div>`;
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => px(num(g, 'w', 914400) * T.sx));
    let rows = '';
    for (const tr of kids(tbl, 'tr')) {
      const h = px(num(tr, 'h', 370840) * T.sy);
      let cells = '';
      for (const tc of kids(tr, 'tc')) {
        if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') continue;
        const span = num(tc, 'gridSpan', 1), rspan = num(tc, 'rowSpan', 1);
        const fill = fillCss(kid(tc, 'tcPr'), ctx);
        const inner = renderText(kid(tc, 'txBody'), tc, part, ctx, { fontRefColor: null, isPh: false, phType: null });
        cells += `<td colspan="${span}" rowspan="${rspan}" style="border:1px solid #c9d0d8;padding:4px 8px;vertical-align:middle;${fill && fill !== 'transparent' ? `background:${fill};` : ''}">${inner || ''}</td>`;
      }
      rows += `<tr style="height:${h}px">${cells}</tr>`;
    }
    return `<div style="position:absolute;${b.css}"><table style="border-collapse:collapse;table-layout:fixed;width:100%">${cols.length ? `<colgroup>${cols.map((c) => `<col style="width:${c}px">`).join('')}</colgroup>` : ''}${rows}</table></div>`;
  }

  global.PptxConverter = { convert };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.PptxConverter;
})(typeof window !== 'undefined' ? window : globalThis);
