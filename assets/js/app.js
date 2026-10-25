/* =============================================================
   理小办 · 站点交互
   ============================================================= */
(function () {
  'use strict';

  const KB = window.LXB_KB;
  const E = window.LXB_Engine;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let campus = '凌水校区';
  let running = false;
  const HIST_KEY = 'lxb_history_v1';

  /* ---------------- 初始：空态 ---------------- */
  function emptyState() {
    const samples = E.quickAsks().slice(0, 5).map((s) => `<li>${esc(s.q)}</li>`).join('');
    $('#pipeline').innerHTML = `
      <div class="empty">
        <b>选择校区，然后用你平时的说法问一句</b>
        <span>三段接力会依次跑完：先给出带出处的事实，再排出步骤与分支，最后补齐每一步的入口、地点、材料、注意事项。</span>
        <ul>${samples}</ul>
      </div>`;
    $('#cardWrap').innerHTML = '';
  }

  /* ---------------- 渲染：流水线各段 ---------------- */
  function stageShell(cls, ico, title, role, body, note) {
    return `<section class="stage ${cls}">
      <div class="stage-hd">
        <span class="stage-ico ${ico}">${title.slice(0, 1)}</span>
        <h4>${esc(title)}</h4><span class="role">${esc(role)}</span>
      </div>
      ${note ? `<div class="stage-note">${note}</div>` : ''}
      ${body}
    </section>`;
  }

  function renderAsk(s) {
    const auto = s.autoCampus
      ? `<div class="stage-note">从提问中识别出校区：${esc(s.campus)}（可在左侧覆盖）</div>` : '';
    const body = `<div class="facts"><ul><li>
        <span class="fx">${esc(s.query)}</span>
        <span class="fs"><b>学生提问</b>${esc(s.campus || '未指定校区')}</span>
      </li></ul></div>`;
    return stageShell('stage-blue', 'ico-blue', '① 信息智能体 · 检索域收窄', '查得准', body, auto);
  }

  function renderInfo(s) {
    const facts = s.facts.map((f) => `<li>
        <span class="fx">${esc(f.text)}</span>
        <span class="fs">
          <b>出处：${esc(f.source)}</b>
          <span class="badge-v ${f.verified === '已核实原文' ? 'bv-ok' : 'bv-no'}">${esc(f.verified)}</span>
          <br>适用：${esc(f.campus)}
        </span>
      </li>`).join('');
    const tags = s.sources.map((x) => `<span class="src-tag">${esc(x.name)}</span>`).join('');
    const note = `命中意图：<b>${esc(s.matchedIntent)}</b>${s.matchedPhrase ? `，由「${esc(s.matchedPhrase)}」这句学生原话触发` : ''}；匹配置信度：${esc(s.confidence)}。`;
    const body = `<ul class="facts">${facts}</ul>
      <div class="srcs"><label>检索域（当前场景的全部依据）</label><div class="src-tags">${tags}</div></div>
      ${s.note ? `<div class="stage-note" style="margin-top:10px">${esc(s.note)}</div>` : ''}`;
    return stageShell('stage-blue', 'ico-blue', '① 信息智能体 · 查得准', '只给事实，不下结论', body, note);
  }

  function renderPlan(s) {
    const items = s.steps.map((st) => `<li>
        <span class="plan-n">${st.n}</span>
        <span class="plan-t">
          <b>${esc(st.title)}</b>
          <p>${esc(st.detail)}</p>
          ${st.branch ? `<div class="branch-box"><b>分支</b> ${esc(st.branch)}</div>` : ''}
        </span>
      </li>`).join('');
    return stageShell('stage-violet', 'ico-violet', '② 规划智能体 · 排得顺', '排出依赖，标出分支',
      `<ul class="plan-list">${items}</ul>`, esc(s.note));
  }

  function renderExec(s) {
    const items = s.steps.map((st) => {
      const e = st.elements;
      const miss = st.missing || [];
      const cell = (k, label, v) => {
        const m = miss.indexOf(k) >= 0 || String(v).indexOf('【待核实】') >= 0;
        return `<div class="el ${m ? 'el-miss' : ''}"><label>${label}</label><span>${esc(v)}</span></div>`;
      };
      return `<div class="exec-item">
        <b>第 ${st.n} 步 · ${esc(st.title)}</b>
        <div class="el-grid">
          ${cell('entry', '入口', e.entry)}
          ${cell('place', '地点', e.place)}
          ${cell('material', '材料', e.material)}
          ${cell('caution', '注意事项', e.caution)}
        </div>
      </div>`;
    }).join('');
    const note = `已按「${esc(s.campus)}」解析地点与入口字段${s.missingTotal ? `；检测到 ${s.missingTotal} 处待核实字段（黄色高亮），按数据纪律保留占位，不以推测填补。` : '；四要素齐全。'}`;
    return stageShell('stage-green', 'ico-green', '③ 执行助手 · 做得成', '补齐四要素，不重排步骤', items, note);
  }

  function renderMiss(s) {
    const tips = s.suggestions || E.quickAsks().slice(0, 6);
    const chips = tips.map((x) =>
      `<button class="chip-btn" data-q="${esc(x.q)}">${esc(x.q)}<span class="s-tag">${esc(x.scene)}</span></button>`).join('');
    return `<div class="miss-card">
      <h4>${esc(s.fallback.title)}</h4>
      <p>${esc(s.fallback.desc)}</p>
      <ul>${s.fallback.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <div class="miss-chips">${chips}</div>
    </div>`;
  }

  /* ---------------- 渲染：办事卡 ---------------- */
  function renderCard(c) {
    const stClass = c.draft ? 'st-draft' : (c.status === '已实跑' ? 'st-ok' : 'st-spec');
    const steps = c.steps.map((st, i) => {
      const e = st.elements;
      const miss = st.missing || [];
      const cell = (k, label, v) => {
        const m = miss.indexOf(k) >= 0 || String(v).indexOf('【待核实】') >= 0;
        return `<div class="el ${m ? 'el-miss' : ''}"><label>${label}</label><span>${esc(v)}</span></div>`;
      };
      return `<div class="cstep ${i === 0 ? 'open' : ''}">
        <div class="cstep-hd" data-toggle>
          <span class="cstep-n">${st.n}</span>
          <b>${esc(st.title)}</b>
          <span class="arrow">›</span>
        </div>
        <div class="cstep-bd">
          <p>${esc(st.detail)}</p>
          <div class="el-grid">
            ${cell('entry', '入口', e.entry)}
            ${cell('place', '地点', e.place)}
            ${cell('material', '材料', e.material)}
            ${cell('caution', '注意事项', e.caution)}
          </div>
        </div>
      </div>`;
    }).join('');

    const openBox = c.openItems.length
      ? `<div class="open-box"><label>本场景待核实事项（不上卡，避免误导）</label>
           <ul>${c.openItems.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>` : '';

    return `<article class="card" id="theCard">
      <div class="card-hd">
        <h4>理小办 · ${esc(c.scenarioName)}办事卡</h4>
        <span class="st ${stClass}">${esc(c.status)}</span>
        <span class="card-campus">适用校区：${esc(c.campus)}</span>
      </div>
      <div class="card-concl">
        <label>结论先行</label>
        <p>${esc(c.conclusion)}</p>
      </div>
      <div class="card-steps">${steps}</div>
      <div class="card-foot">
        <div class="basis">
          <b>依据：</b>${esc(c.basis)}
          <div class="basis-list">更新时间：${esc(c.updated)} · 共 ${c.steps.length} 步${c.missingTotal ? ` · 含 ${c.missingTotal} 处待核实字段` : ''}</div>
        </div>
        ${openBox}
        <div class="card-acts">
          <button class="btn btn-ghost btn-sm" id="copyCard">复制办事卡</button>
          <button class="btn btn-ghost btn-sm" id="expandAll">展开 / 收起全部步骤</button>
        </div>
        <div class="follow">
          <input id="followInput" placeholder="就其中任一步继续追问，例如：找回原来的卡怎么办？">
          <button class="btn btn-primary btn-sm" id="followBtn">追问</button>
        </div>
      </div>
    </article>`;
  }

  function cardToText(c) {
    const lines = [];
    lines.push(`理小办 · ${c.scenarioName}办事卡`);
    lines.push(`适用校区：${c.campus}　状态：${c.status}`);
    lines.push(`结论：${c.conclusion}`);
    lines.push('');
    c.steps.forEach((s) => {
      lines.push(`第 ${s.n} 步 · ${s.title}`);
      lines.push(`　入口：${s.elements.entry}`);
      lines.push(`　地点：${s.elements.place}`);
      lines.push(`　材料：${s.elements.material}`);
      lines.push(`　注意事项：${s.elements.caution}`);
      if (s.branch) lines.push(`　分支：${s.branch}`);
      lines.push('');
    });
    lines.push(`依据：${c.basis}`);
    lines.push(`更新时间：${c.updated}`);
    if (c.openItems.length) {
      lines.push('');
      lines.push('待核实事项：');
      c.openItems.forEach((o) => lines.push(`- ${o}`));
    }
    return lines.join('\n');
  }

  let lastCard = null;

  /* ---------------- toast ---------------- */
  let toastEl = null;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  /* ---------------- 历史 ---------------- */
  function pushHistory(q, c) {
    let h = [];
    try { h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { h = []; }
    h.unshift({ q, campus: c, t: Date.now() });
    h = h.slice(0, 8);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) { /* file:// 下忽略 */ }
    renderHistory(h);
  }
  function renderHistory(h) {
    const wrap = $('#histWrap');
    if (!h || !h.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('#histList').innerHTML = h.map((x) =>
      `<li><button class="hist-btn" data-q="${esc(x.q)}" data-campus="${esc(x.campus)}">${esc(x.q)} · ${esc(x.campus)}</button></li>`).join('');
  }
  function loadHistory() {
    try { renderHistory(JSON.parse(localStorage.getItem(HIST_KEY) || '[]')); } catch (e) { /* noop */ }
  }

  /* ---------------- 主流程 ---------------- */
  async function run(q, campusOverride) {
    if (running) return;
    const query = String(q || '').trim();
    if (!query) { toast('先输入你想问的问题'); $('#qInput').focus(); return; }

    running = true;
    $('#pipeline').innerHTML = '';
    $('#cardWrap').innerHTML = '';
    const btn = $('#runBtn'), txt = $('#runBtnText');
    btn.disabled = true; txt.textContent = '三段接力进行中…';

    const ctx = { campus: campusOverride || campus };

    const add = (html) => {
      const d = document.createElement('div');
      d.innerHTML = html;
      while (d.firstElementChild) $('#pipeline').appendChild(d.firstElementChild);
    };

    try {
      const res = await E.run(query, ctx, {
        delay: 480,
        onStage: (s) => {
          if (s.kind === 'ask') add(renderAsk(s));
          else if (s.kind === 'info') add(renderInfo(s));
          else if (s.kind === 'plan') add(renderPlan(s));
          else if (s.kind === 'exec') add(renderExec(s));
          else if (s.kind === 'miss') $('#cardWrap').innerHTML = renderMiss(s);
        }
      });

      if (res.ok && !res.missed) {
        lastCard = res.card;
        $('#cardWrap').innerHTML = renderCard(res.card);
        bindCard();
        pushHistory(query, res.card.campus);
      }
    } catch (err) {
      toast('出错了：' + err.message);
    } finally {
      running = false;
      btn.disabled = false; txt.textContent = '生成办事卡';
    }
  }

  function bindCard() {
    // 步骤折叠
    $$('.cstep-hd[data-toggle]', $('#theCard')).forEach((hd) => {
      hd.addEventListener('click', () => hd.parentElement.classList.toggle('open'));
    });
    // 复制
    const cp = $('#copyCard');
    if (cp) cp.addEventListener('click', () => {
      const t = cardToText(lastCard);
      const done = () => toast('办事卡已复制到剪贴板');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
      } else fallbackCopy(t, done);
    });
    // 展开全部
    const ea = $('#expandAll');
    if (ea) ea.addEventListener('click', () => {
      const steps = $$('.cstep', $('#theCard'));
      const anyClosed = steps.some((s) => !s.classList.contains('open'));
      steps.forEach((s) => s.classList.toggle('open', anyClosed));
    });
    // 追问
    const fb = $('#followBtn'), fi = $('#followInput');
    if (fb) fb.addEventListener('click', () => {
      const v = fi.value.trim();
      if (!v) { toast('输入你想追问的内容'); return; }
      $('#qInput').value = v;
      $('#demo').scrollIntoView({ behavior: 'smooth', block: 'start' });
      run(v);
    });
    if (fi) fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#followBtn').click(); });
  }

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); cb(); } catch (e) { toast('复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 静态区块渲染 ---------------- */
  function renderSamples() {
    const list = E.quickAsks();
    $('#sampleChips').innerHTML = list.map((s) =>
      `<button class="chip-btn" data-q="${esc(s.q)}">${esc(s.q)}<span class="s-tag">${esc(s.scene)}</span></button>`).join('');
  }

  function countIntents(sc) { return sc.intents.reduce((a, i) => a + (i.phrases || []).length, 0) + sc.intents.length; }

  function renderMatrix() {
    $('#sceneMatrix').innerHTML = KB.scenarios.map((sc) => {
      const stClass = sc.draft ? 'st-draft' : (sc.status === '已实跑' ? 'st-ok' : 'st-spec');
      const ask = (sc.intents[0].phrases || [sc.intents[0].canonical])[0];
      return `<article class="scene" data-q="${esc(ask)}">
        <div class="scene-hd"><h4>${esc(sc.name)}</h4><span class="st ${stClass}">${esc(sc.status)}</span></div>
        <p>${esc(sc.oneLine)}</p>
        <div class="scene-meta">
          <span><b>${sc.sources.length}</b> 份依据</span>
          <span><b>${sc.facts.length}</b> 条事实</span>
          <span><b>${countIntents(sc)}</b> 句真实问法</span>
          <span><b>${sc.openItems.length}</b> 项待核实</span>
        </div>
      </article>`;
    }).join('');
  }

  function renderOpenItems() {
    $('#openItems').innerHTML = KB.scenarios.map((sc) => {
      const stClass = sc.draft ? 'st-draft' : (sc.status === '已实跑' ? 'st-ok' : 'st-spec');
      return `<div class="oi-group">
        <b>${esc(sc.name)} <span class="st ${stClass}">${esc(sc.status)}</span></b>
        <ul>${sc.openItems.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>`;
    }).join('');
  }

  function renderSources() {
    const all = [];
    KB.scenarios.forEach((sc) => sc.sources.forEach((s) => all.push({ s, sc })));
    $('#srcAll').innerHTML = all.map(({ s, sc }) => {
      const cls = s.verified === '已核实原文' ? 'bv-ok' : 'bv-no';
      return `<div class="src-card">
        <b>${esc(s.name)}</b>
        <p>${esc(s.fact)}</p>
        <div class="sc-line">覆盖：${esc(s.scope)} · 来源：${esc(s.source)} · <span class="badge-v ${cls}">${esc(s.verified)}</span> · 用于：${esc(sc.name)}</div>
      </div>`;
    }).join('');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#campusSeg').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      $$('.seg-btn', $('#campusSeg')).forEach((x) => x.classList.toggle('is-on', x === b));
      campus = b.dataset.campus;
      if (lastCard) run($('#qInput').value.trim(), campus);
    });

    $('#runBtn').addEventListener('click', () => run($('#qInput').value.trim()));

    $('#qInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); run($('#qInput').value.trim()); }
    });

    // 快捷问法（演示区 + 卡片内的兜底建议）
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-q]'); if (!c) return;
      const q = c.dataset.q, cp = c.dataset.campus;
      if (cp) {
        $$('.seg-btn', $('#campusSeg')).forEach((x) => x.classList.toggle('is-on', x.dataset.campus === cp));
        campus = cp;
      }
      if (c.closest('#sceneMatrix')) {
        $('#demo').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      $('#qInput').value = q;
      run(q, cp || campus);
    });

    $('#histList').addEventListener('click', (e) => {
      const b = e.target.closest('.hist-btn'); if (!b) return;
      $('#qInput').value = b.dataset.q;
      run(b.dataset.q, b.dataset.campus);
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderSamples();
    renderMatrix();
    renderOpenItems();
    renderSources();
    emptyState();
    bind();
    loadHistory();

    // 支持分享链接：?q=校园卡丢了怎么办&campus=盘锦校区
    const sp = new URLSearchParams(location.search);
    const sq = sp.get('q'), cp = sp.get('campus');
    if (sq) {
      $('#qInput').value = sq;
      if (cp && KB.CAMPUSES.indexOf(cp) >= 0) {
        $$('.seg-btn', $('#campusSeg')).forEach((x) => x.classList.toggle('is-on', x.dataset.campus === cp));
        campus = cp;
      }
      $('#demo').scrollIntoView({ block: 'start' });
      run(sq, campus);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
