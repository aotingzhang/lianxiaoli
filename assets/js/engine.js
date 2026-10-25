/* =============================================================
   理小办 · 三智能体推理引擎
   -------------------------------------------------------------
   职责边界严格对应 SKILL.md 的定义，三个函数互不越界：
     retrieve()  信息智能体：只产出「带出处的原始事实」，不下结论
     plan()      规划智能体：只产出「有序步骤 + 分支」，不查规定、不填地点
     execute()   执行助手：只为每步补「入口/地点/材料/注意事项」，不重排步骤
     consolidate() 理小办收口：合并三路结果成一张办事卡
   ============================================================= */

window.LXB_Engine = (function () {
  'use strict';

  const KB = window.LXB_KB;

  /* ---------- 工具 ---------- */
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？、；：""''（）()\[\]【】,.!?;:~`'"\/\\-]/g, '');

  // 中文数字 → 阿拉伯数字，便于「十一点」与「23:00」这类表达共存
  const CN_NUM = { 十: 10, 十一: 11, 十二: 12 };
  function cnNum(s) {
    const m = String(s).match(/([零一二三四五六七八九十]+)点/);
    return m ? CN_NUM[m[1]] : null;
  }
  void cnNum;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 实体抽取：校区 ---------- */
  function detectCampus(q) {
    if (/盘锦|dgpj|0427/.test(q)) return '盘锦校区';
    if (/开发区|七舍|第七学生宿舍/.test(q)) return '开发区校区';
    if (/凌水|西山|主校区|网信|网信中心/.test(q)) return '凌水校区';
    return null;
  }

  /* 字符二元组的 Dice 相似度：让「卡找回来了还能用吗」也能匹配到「卡找回来了怎么办」 */
  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }
  function dice(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    A.forEach((g) => { if (B.has(g)) inter++; });
    return (2 * inter) / (A.size + B.size);
  }

  /* ---------- 意图匹配：支持同义、模糊、包含关系 ---------- */
  function scoreQuery(q, intent, scenario) {
    const nq = norm(q);
    if (!nq) return 0;
    let best = 0, matchedPhrase = null;

    // 动作触发词：只有当学生的话里真的出现「坏了/丢了/请假」这类问题信号时，
    // 才允许用相似度兜底。否则像「图书馆几点关门」这种只有实体词的问题会被误判。
    const trig = Array.from(new Set((intent.triggers || []).map(norm))).filter(Boolean);
    const hasTrig = trig.some((t) => nq.includes(t));

    const pool = [intent.canonical].concat(intent.phrases || []);
    pool.forEach((p) => {
      const np = norm(p);
      if (!np) return;
      let s = 0;
      if (nq === np) s = 100;
      else if (nq.includes(np)) s = 60 + Math.min(38, np.length * 2);
      else if (np.includes(nq) && nq.length >= 2) s = 45 + Math.min(30, nq.length * 2);
      // 相似但不互相包含的说法（学生最常这样问）——需要动作触发词背书
      if (s < 100 && hasTrig) s = Math.max(s, dice(nq, np) * 100);
      if (s > best) { best = s; matchedPhrase = p; }
    });

    // 关键词加权：命中越多越可信
    const kws = intent.keywords || [];
    const unique = Array.from(new Set(kws.map(norm))).filter(Boolean);
    let hit = 0;
    unique.forEach((k) => { if (nq.includes(k)) hit++; });
    if (hit) {
      const kScore = Math.min(46, hit * 16);
      best = Math.max(best, kScore);
      if (hit >= 2 && best > 0) best += 6;
    }
    // 只有实体词、没有任何问题/动作信号时不给相似度分（避免误判）

    // 场景名直接命中
    if (nq.includes(norm(scenario.short))) best += 8;

    return { score: best, matchedPhrase };
  }

  function matchIntent(q, ctx) {
    let best = null;
    KB.scenarios.forEach((sc) => {
      sc.intents.forEach((it) => {
        const r = scoreQuery(q, it, sc);
        const adjusted = r.score - (sc.draft ? 5 : 0); // 草稿场景优先级略低
        if (!best || adjusted > best.score) {
          best = { scenario: sc, intent: it, score: adjusted, matchedPhrase: r.matchedPhrase };
        }
      });
    });
    return best;
  }

  /* =========================================================
     ① 信息智能体 —— 查得准
     产出：带出处的原始事实片段。禁止下结论、给建议。
     ========================================================= */
  function retrieve(query, ctx, hit) {
    const sc = hit.scenario;
    const campus = ctx.campus || '未指定校区';

    const all = sc.facts.slice();
    // 排序：适用本校区的排前，通用的次之，其他校区的压后（仍保留，用于说明差异）
    const rank = (f) => (f.campus === campus ? 0 : (f.campus === '通用' ? 1 : 2));
    all.sort((a, b) => rank(a) - rank(b));

    // 按命中的 intent 关键词做轻量相关排序，不删条款（避免漏掉关键约束）
    const kw = (hit.intent.keywords || []).map(norm).filter(Boolean);
    if (kw.length) {
      all.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        const ha = kw.some((k) => norm(a.fact).includes(k)) ? 1 : 0;
        const hb = kw.some((k) => norm(b.fact).includes(k)) ? 1 : 0;
        return hb - ha;
      });
    }

    const facts = all.slice(0, 6).map((f) => ({
      text: f.fact,
      source: f.source,
      campus: f.campus,
      verified: sc.draft ? '待核实' : '已核实原文'
    }));

    const sources = sc.sources.map((s) => ({
      name: s.name, scope: s.scope, source: s.source, verified: s.verified
    }));

    return {
      agent: 'info',
      corpus: sc.domain,
      matchedIntent: hit.intent.canonical,
      matchedPhrase: hit.matchedPhrase,
      confidence: hit.score >= 60 ? '高' : '中',
      facts,
      sources,
      note: sc.draft
        ? '该场景处于草稿状态，检索域内的来源尚未逐条回原文核实，卡片中的【待核实】字段不可直接照办。'
        : ''
    };
  }

  /* =========================================================
     ② 规划智能体 —— 排得顺
     产出：有序步骤 + 显式分支。禁止查规定、填地点材料。
     ========================================================= */
  function plan(hit) {
    const steps = hit.intent.steps.map((s) => ({
      n: s.n,
      title: s.title,
      detail: s.detail,
      branch: s.branch || null,
      elements: s.elements || {}
    }));
    const branchCount = steps.filter((s) => s.branch).length;
    return {
      agent: 'plan',
      steps,
      branchCount,
      note: branchCount
        ? `识别出 ${branchCount} 个条件分支，已显式标出——分支被抹平是学生白跑一趟的主要原因。`
        : '该路径暂无条件分支，按序执行即可。'
    };
  }

  /* =========================================================
     ③ 执行助手 —— 做得成
     为每步补齐四要素（入口 / 地点 / 材料 / 注意事项），按校区解析。
     禁止重排步骤、修改结论。
     ========================================================= */
  function resolve(v, campus) {
    if (v == null) return '—';
    if (typeof v === 'string') return v;
    return v[campus] || v['default'] || '—';
  }

  function execute(planResult, ctx) {
    const campus = ctx.campus || '未指定校区';
    const steps = planResult.steps.map((s) => {
      const e = s.elements;
      const place = resolve(e.place, campus);
      const missing = [];
      ['entry', 'place', 'material', 'caution'].forEach((k) => {
        const v = resolve(e[k], campus);
        if (!v || v === '—') missing.push(k);
        else if (String(v).includes('【待核实】') || String(v).includes('待核实')) missing.push(k + '(含待核实)');
      });
      return Object.assign({}, s, {
        elements: {
          entry: resolve(e.entry, campus),
          place: e.placeNote ? `${place}（${e.placeNote}）` : place,
          material: resolve(e.material, campus),
          caution: resolve(e.caution, campus)
        },
        missing
      });
    });
    return {
      agent: 'exec',
      steps,
      campus,
      missingTotal: steps.reduce((a, s) => a + s.missing.length, 0)
    };
  }

  /* =========================================================
     🧠 理小办 —— 统一收口
     结论先行、步骤可执行、依据可追溯。只给一个答案。
     ========================================================= */
  function consolidate(infoResult, execResult, hit, ctx) {
    const sc = hit.scenario;
    const campus = ctx.campus || '未指定校区';
    const ctxView = {
      campus,
      campusShort: campus === '未指定校区' ? '所在校区' : campus.replace('校区', '')
    };
    const conclusion = typeof hit.intent.conclusion === 'function'
      ? hit.intent.conclusion(ctxView)
      : String(hit.intent.conclusion || '');

    return {
      scenarioId: sc.id,
      scenarioName: sc.name,
      status: sc.status,
      draft: !!sc.draft,
      campus,
      intentName: hit.intent.canonical,
      conclusion,
      steps: execResult.steps,
      basis: sc.sources.map((s) => s.name).join(' · '),
      sourceList: sc.sources,
      updated: '【待填写】',
      openItems: sc.openItems || [],
      missingTotal: execResult.missingTotal
    };
  }

  /* =========================================================
     对外：一次完整链路。返回四段产物，供 UI 逐段渲染。
     ========================================================= */
  async function run(rawQuery, ctx, opts) {
    const cfg = Object.assign({ delay: 520, onStage: null }, opts || {});
    const q = String(rawQuery || '').trim();

    if (!q) return { ok: false, error: '请输入你的问题' };

    const campus = ctx.campus || detectCampus(q) || null;
    const context = Object.assign({}, ctx, { campus });

    const stages = [];
    const emit = async (s) => {
      stages.push(s);
      if (cfg.onStage) await cfg.onStage(s);
      if (cfg.delay) await sleep(cfg.delay);
    };

    // —— 步骤 0：学生提问 + 槽位识别 ——
    emit({
      kind: 'ask',
      query: q,
      campus: campus,
      autoCampus: !ctx.campus && !!detectCampus(q)
    });

    const hit = matchIntent(q, context);

    // 未命中：如实告知检索域边界，不给编造的答案
    // （阈值 26：低于此值说明只碰巧撞上一个通用词）
    if (!hit || hit.score < 26) {
      emit({ kind: 'miss', fallback: KB.FALLBACK, query: q });
      return {
        ok: true,
        missed: true,
        query: q,
        campus,
        fallback: KB.FALLBACK,
        suggestions: suggest(q),
        stages
      };
    }

    const info = retrieve(q, context, hit);
    emit(Object.assign({ kind: 'info' }, info));

    const planR = plan(hit);
    emit(Object.assign({ kind: 'plan' }, planR));

    const execR = execute(planR, context);
    emit(Object.assign({ kind: 'exec' }, execR));

    const card = consolidate(info, execR, hit, context);
    emit({ kind: 'card', card });

    return { ok: true, missed: false, stages, card, plan: planR, info, exec: execR };
  }

  /* 未命中时给出可选建议（来自真实配置的问法，不是生成出来的） */
  function suggest() {
    return quickAsks().slice(0, 6);
  }

  /* 给 UI 用的快捷问法（真实的学生说法） */
  function quickAsks() {
    const list = [];
    KB.scenarios.forEach((sc) => {
      sc.intents.forEach((it) => {
        (it.phrases || []).slice(0, 1).forEach((p) => {
          list.push({ q: p, scene: sc.short, status: sc.status });
        });
      });
    });
    return list;
  }

  return { run, matchIntent, detectCampus, quickAsks, norm };
})();
