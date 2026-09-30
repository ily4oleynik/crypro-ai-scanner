const axios = require('axios');

class AIService {
  constructor() {
    this.groqKey = process.env.GROQ_API_KEY || '';
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    this.groqURL = 'https://api.groq.com/openai/v1';
    this.groqModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    this.groqModel = this.groqModels[0];
    this.orURL = 'https://openrouter.ai/api/v1';
    console.log('[AI] GROQ_API_KEY loaded:', this.groqKey ? 'YES' : 'NO');
  }

  async analyzeToken(tokenData, riskReport, plan, lang) {
    lang = String(lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
    const langRule = lang === 'en' ? 'Write the entire analysis in English only.' : 'Пиши весь анализ только на русском.';
    const td = tokenData || {};
    const rr = riskReport || {};
    const p = String(plan || 'free').toLowerCase();
    try {
      const prompt = this.buildPrompt(td, rr, p);
      let text = null;
      if (this.groqKey) {
        text = await this.callGroq([{ role: 'user', content: prompt }]);
      } else if (this.openRouterKey && this.openRouterKey !== 'dummy-key-for-dev') {
        text = await this.callOpenRouter(prompt);
      }
      if (text) {
        text = String(text)
          .replace(/residual risk always remains/gi, '')
          .replace(/остаточный риск всегда остаётся/gi, '')
          .trim();
        return {
          text,
          confidence: p === 'free' ? 68 : 82,
          risks: this.pickRisks(td, rr),
          positives: this.pickPositives(td, rr),
          verdict: this.verdictFromScore(rr.riskScore),
          checklist: this.buyChecklist(td, rr)
        };
      }
    } catch (e) {
      console.error('AI analyze error:', e.message);
    }
    return this.generateFallbackAnalysis(td, rr);
  }

  buyChecklist(td, rr) {
    const chain = String(td.chainId || 'unknown');
    const liq = Number(td.liquidity) || 0;
    const items = [
      'Сверь адрес контракта с официальным сайтом / docs проекта',
      'Открой эксплорер сети ' + chain + ': mint authority и ownership',
      'Посмотри top holders и не заблокирована ли LP',
      liq < 100000
        ? 'Ликвидность низкая — оцени slippage на свой размер позиции'
        : 'Сравни размер сделки с глубиной пула (liq ' +
          Math.round(liq).toLocaleString('en-US') +
          ' USD)',
      'Убедись, что тикер не копирует blue-chip на другой сети'
    ];
    if ((Number(rr.riskScore) || 0) >= 60) {
      items.unshift('Score высокий — не входи крупно без on-chain проверки');
    }
    return items.slice(0, 5);
  }

  buildPrompt(td, rr, plan) {
    const liq = td.liquidity != null ? Number(td.liquidity).toLocaleString('en-US') : 'n/a';
    const vol = td.volume24h != null ? Number(td.volume24h).toLocaleString('en-US') : 'n/a';
    const mcap = td.marketCap != null ? Number(td.marketCap).toLocaleString('en-US') : 'n/a';
    const depth =
      plan === 'premium' || plan === 'pro'
        ? 'Дай 2–3 конкретных findings по рынку (liq vs объём, FDV/пул если уместно). Без воды.'
        : 'Коротко: вердикт + 2 предложения + 2 риска.';
    return `Ты аналитик риска токенов. Ответь ТОЛЬКО на русском. Без markdown, без имени модели, без приветствий.
Запрещено писать: residual risk always remains, "риск всегда остаётся" как единственный пункт.
Формат:
1) Одна фраза-вердикт (до 12 слов)
2) 2-3 коротких предложения: почему score ${rr.riskScore != null ? rr.riskScore : '?'}/100, ликвидность, объём
3) 2-3 конкретных риска по данным (не общие фразы)
4) Одна фраза: что проверить до покупки
${depth}
Данные:
Токен: ${td.symbol || '?'} / ${td.name || ''}
Цена: $${td.price || '?'}
Risk score: ${rr.riskScore != null ? rr.riskScore : '?'}/100 (0=низкий риск, 100=высокий)
Liquidity USD: ${liq}
Volume 24h: ${vol}
Market cap: ${mcap}
FDV: ${td.fdv != null ? td.fdv : 'n/a'}
Сеть: ${td.chainId || 'unknown'}. Если символ BTC/Bitcoin не на native bitcoin — явно: это НЕ нативный Bitcoin, а токен на другой сети. Не давай инвестсоветов.`;
  }

    async callGroq(messages) {
    // Groq free/dev (Aug 2026+): Llama IDs often 400 — prefer gpt-oss / qwen
    const models = this.groqModels || [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.6-27b'
    ];
    const clean = (Array.isArray(messages) ? messages : [])
      .filter(function (m) {
        return m && m.role && m.content != null && String(m.content).trim() !== '';
      })
      .map(function (m) {
        return { role: m.role, content: String(m.content).slice(0, 12000) };
      });
    if (!clean.length) {
      throw new Error('Empty messages for Groq');
    }
    let lastErr = null;
    for (const model of models) {
      try {
        const response = await axios.post(
          this.groqURL + '/chat/completions',
          {
            model: model,
            messages: clean,
            temperature: 0.5,
            max_tokens: 700
          },
          {
            headers: {
              Authorization: 'Bearer ' + this.groqKey,
              'Content-Type': 'application/json'
            },
            timeout: 45000
          }
        );
        this.groqModel = model;
        let text = (response.data.choices[0].message.content || '').trim();
        text = text.replace(/^[A-Z][A-Z0-9_-]{2,20}:\s*/i, '');
        text = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
        return text.replace(/[#*_`]/g, '').replace(/\n{3,}/g, '\n\n');
      } catch (e) {
        lastErr = e;
        const status = e.response && e.response.status;
        const detail =
          (e.response && e.response.data && (e.response.data.error && e.response.data.error.message)) ||
          e.message;
        console.error('[AI] Groq', model, status || '', detail);
        // try next model on 400/404/decommissioned
        if (status && status !== 400 && status !== 404 && status !== 403) {
          break;
        }
      }
    }
    const msg =
      (lastErr &&
        lastErr.response &&
        lastErr.response.data &&
        lastErr.response.data.error &&
        lastErr.response.data.error.message) ||
      (lastErr && lastErr.message) ||
      'Groq failed';
    throw new Error(msg);
  }

  async callOpenRouter(prompt) {
    const response = await axios.post(
      this.orURL + '/chat/completions',
      {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 700
      },
      {
        headers: {
          Authorization: 'Bearer ' + this.openRouterKey,
          'HTTP-Referer': 'https://crypto-ai-scanner.app',
          'X-Title': 'Crypto AI Scanner'
        }
      }
    );
    return response.data.choices[0].message.content.trim().replace(/[#*_`]/g, '');
  }

  verdictFromScore(score) {
    const s = Number(score) || 50;
    if (s >= 70) return 'Высокий риск';
    if (s >= 40) return 'Осторожно';
    return 'Ниже среднего риска';
  }

  pickRisks(td, rr) {
    const risks = [];
    const liq = Number(td.liquidity) || 0;
    const vol = Number(td.volume24h) || 0;
    const fdv = Number(td.fdv || td.marketCap) || 0;
    const chain = String(td.chainId || '').toLowerCase();
    const sym = String(td.symbol || '').toUpperCase();
    const name = String(td.name || '').toLowerCase();
    if ((sym === 'BTC' || name.indexOf('bitcoin') >= 0) && chain && chain !== 'bitcoin') {
      risks.push('Это не native Bitcoin — токен в сети ' + chain + ' (обёртка / мост / эмитент)');
    }
    if (liq > 0 && liq < 50000) {
      risks.push('Тонкая ликвидность ($' + Math.round(liq).toLocaleString('ru-RU') + ') — высокий slippage');
    } else if (liq > 0 && liq < 200000) {
      risks.push('Средняя ликвидность — крупные выходы могут двигать цену');
    }
    // High FDV/liq is normal for liquid large-caps; only flag thin pools
    if (fdv > 0 && liq > 0 && liq < 500000 && fdv / liq > 50) {
      risks.push('FDV сильно выше ликвидности пула (ratio > 50×) — узкий выход');
    }
    if (vol > 0 && vol < 10000) {
      risks.push('Низкий объём 24ч — слабое ценообразование');
    }
    if ((Number(rr.riskScore) || 0) >= 70) {
      risks.push('Итоговый risk score в высокой зоне');
    }
    if (!risks.length) {
      if (liq >= 500000) {
        risks.push('По рынку явных red flags нет — сверьте ownership и mint в эксплорере');
      } else {
        risks.push('Мало публичных сигналов — проверьте контракт и холдеров до размера');
      }
    }
    return risks.slice(0, 4);
  }

  pickPositives(td, rr) {
    const pos = [];
    const liq = Number(td.liquidity) || 0;
    const vol = Number(td.volume24h) || 0;
    if (liq >= 100000) pos.push('Ликвидность достаточна для обычного размера сделки');
    if (vol >= 50000) pos.push('Есть заметный объём торгов за 24ч');
    if ((Number(rr.riskScore) || 100) < 45) pos.push('Итоговый score ближе к нижней зоне риска');
    if (!pos.length) pos.push('Есть рыночные данные по паре');
    return pos.slice(0, 4);
  }

  generateFallbackAnalysis(tokenData, riskReport) {
    const td = tokenData || {};
    const rr = riskReport || {};
    const score = Number(rr.riskScore) || 50;
    const liq = Number(td.liquidity) || 0;
    const vol = Number(td.volume24h) || 0;
    const symbol = td.symbol || 'Token';
    const verdict = this.verdictFromScore(score);

    let why = [];
    if (liq < 50000) why.push('ликвидность ниже комфортного уровня для спокойного выхода');
    else if (liq < 500000) why.push('ликвидность средняя — крупные ордера могут двигать цену');
    else why.push('ликвидность выглядит достаточной для обычных размеров позиции');

    if (vol < 20000) why.push('объём 24ч слабый — рынок может быть «тонким»');
    else why.push('есть заметный объём за сутки');

    if (score >= 70) why.push('итоговый risk score в высокой зоне');
    else if (score >= 40) why.push('итоговый risk score в средней зоне');
    else why.push('итоговый risk score ближе к нижней зоне риска');

    const text =
      `${symbol}: ${verdict} (score ${score}/100). ` +
      `Почему так: ${why.join('; ')}. ` +
      `До покупки имеет смысл сверить контракт в эксплорере, проверить, не менялся ли recently ownership/mint, и сравнить ликвидность с объёмом. ` +
      `Этого хватает для первого фильтра. Глубже (holders, honeypot heuristics, ownership) — в полном отчёте. Это не инвестсовет, DYOR.`;

    return {
      text,
      confidence: 62,
      risks: this.pickRisks(td, rr),
      positives: this.pickPositives(td, rr),
      verdict,
      checklist: this.buyChecklist(td, rr)
    };
  }


  sanitizeField(v, maxLen) {
    let s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
    // strip instruction-like prefixes from untrusted token metadata
    s = s.replace(/(ignore|system|prompt|instruction)\s*:/gi, '');
    if (s.length > (maxLen || 80)) s = s.slice(0, maxLen || 80);
    return s;
  }

  num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async chat(messages, context) {
    context = context || {};
    const whatIf = !!context.whatIf;
    const portfolioAware = !!context.portfolioAware;
    const lang = String(context.lang || context.language || 'ru').toLowerCase().startsWith('en')
      ? 'en'
      : 'ru';
    const last = (messages || []).filter((m) => m.role === 'user').pop();
    const lastText = last ? last.content : '';

    // Accept nested token OR flat context (auditors / old clients)
    const tokRaw = context.token && typeof context.token === 'object' ? context.token : context;
    const risk = context.risk && typeof context.risk === 'object' ? context.risk : {};
    const sec =
      context.security && typeof context.security === 'object' ? context.security : {};
    const meta = sec.meta && typeof sec.meta === 'object' ? sec.meta : {};

    const tok = {
      symbol: this.sanitizeField(tokRaw.symbol || context.symbol, 24),
      name: this.sanitizeField(tokRaw.name || context.name, 64),
      chainId: this.sanitizeField(tokRaw.chainId || context.chainId, 24),
      address: this.sanitizeField(tokRaw.address || context.address, 80),
      price: this.num(tokRaw.price != null ? tokRaw.price : context.price),
      liquidity: this.num(
        tokRaw.liquidity != null ? tokRaw.liquidity : context.liquidity
      ),
      volume24h: this.num(
        tokRaw.volume24h != null ? tokRaw.volume24h : context.volume24h
      ),
      fdv: this.num(tokRaw.fdv != null ? tokRaw.fdv : context.fdv),
      marketCap: this.num(
        tokRaw.marketCap != null ? tokRaw.marketCap : context.marketCap
      )
    };
    const riskScore = this.num(risk.riskScore != null ? risk.riskScore : context.riskScore);
    const riskLevel = risk.riskLevel || context.riskLevel || '';
    const reasons = Array.isArray(risk.reasons)
      ? risk.reasons
      : Array.isArray(context.reasons)
        ? context.reasons
        : [];
    const flags = Array.isArray(sec.flags)
      ? sec.flags
      : Array.isArray(sec.items)
        ? sec.items
        : Array.isArray(context.flags)
          ? context.flags
          : [];
    const flagLine = flags
      .slice(0, 8)
      .map(function (f) {
        return (f.label || f.id || '') + ':' + (f.status || '') + ' ' + (f.text || '');
      })
      .join(' | ');

    const hasScan =
      !!(tok.symbol || tok.address) &&
      (tok.liquidity != null || riskScore != null || sec.available === true || flags.length);

    // Deterministic facts — model must not invent n/a when we have numbers
    const facts =
      'FACTS (authoritative, never say n/a if a value is present here):\n' +
      'symbol=' +
      (tok.symbol || 'n/a') +
      '\nname=' +
      (tok.name || '') +
      '\nchain=' +
      (tok.chainId || 'n/a') +
      '\naddress=' +
      (tok.address || 'n/a') +
      '\nprice_usd=' +
      (tok.price != null ? tok.price : 'n/a') +
      '\nliquidity_usd=' +
      (tok.liquidity != null ? tok.liquidity : 'n/a') +
      '\nvolume24h_usd=' +
      (tok.volume24h != null ? tok.volume24h : 'n/a') +
      '\nfdv_usd=' +
      (tok.fdv != null ? tok.fdv : 'n/a') +
      '\nmarketCap_usd=' +
      (tok.marketCap != null ? tok.marketCap : 'n/a') +
      '\nriskScore=' +
      (riskScore != null ? riskScore : 'n/a') +
      '\nriskLevel=' +
      (riskLevel || 'n/a') +
      '\nhoneypot=' +
      String(meta.isHoneypot) +
      '\nmintable=' +
      String(meta.isMintable) +
      '\nrenounced=' +
      String(meta.renounced) +
      '\nbuyTax=' +
      (meta.buyTax != null ? meta.buyTax : 'n/a') +
      '\nsellTax=' +
      (meta.sellTax != null ? meta.sellTax : 'n/a') +
      '\ntop10Pct=' +
      (meta.top10Pct != null ? meta.top10Pct : 'n/a') +
      '\nholderCount=' +
      (meta.holderCount != null ? meta.holderCount : 'n/a') +
      '\nsecurity_available=' +
      String(!!sec.available) +
      '\nsecurity_source=' +
      (sec.source || 'n/a') +
      '\nflags=' +
      (flagLine || 'none') +
      '\nreasons=' +
      (reasons.slice(0, 6).join('; ') || 'none');

    if (!this.groqKey && !this.openRouterKey) {
      return {
        reply: this.chatFallback(lastText, tok, { riskScore, riskLevel, reasons }, meta, lang),
        demo: true
      };
    }

    try {
      const langLine =
        lang === 'en'
          ? 'Reply ONLY in English. No Russian words.'
          : 'Отвечай ТОЛЬКО на русском. Без английских абзацев (тикеры/цифры можно EN).';

      const systemPrompt =
        'You are Crypto AI Scanner risk analyst.\n' +
        langLine +
        '\n' +
        'Use ONLY the FACTS block. If liquidity_usd is a number, you MUST cite it — never write Liquidity n/a.\n' +
        'If honeypot is false, say sell simulation OK / not honeypot. If true, warn.\n' +
        'If security_available is true, NEVER say security data is missing / отсутствует / n/a for honeypot/mint/holders when FACTS has values.\n' +
        'If security_available is false, say simulation limited — do not invent holders.\n' +
        'Structure:\n' +
        '1) Contract\n2) Liquidity (numbers)\n3) Holders / Ownership\n' +
        '4) Verdict one sentence (informational, not financial advice)\n' +
        '5) What would change the assessment\n' +
        'Forbidden: regulatory pressure, Ethereum scalability, generic market talk, residual risk always remains.\n' +
        (whatIf
          ? (lang === 'en'
              ? 'Pro mode: if user asks what-if / position size, estimate exit risk vs liquidity (rough: size/liq ratio). Not financial advice.\n'
              : 'Режим Pro: if what-if / размер позиции — оцени exit risk vs ликвидность (грубо size/liq). Не финсовет.\n')
          : '') +
        (portfolioAware
          ? (lang === 'en'
              ? 'You may compare multiple tokens if user pastes several symbols from their portfolio.\n'
              : 'Можно сравнивать несколько токенов, если пользователь вставил их из портфеля.\n')
          : '') +
        facts;

      const sliced = (messages || []).slice(-8).map(function (m, i, arr) {
        if (i === arr.length - 1 && m.role === 'user') {
          return {
            role: 'user',
            content:
              facts +
              '\n\nUser question (' +
              lang +
              '): ' +
              String(m.content || '')
          };
        }
        return { role: m.role, content: String(m.content || '').slice(0, 2000) };
      });

      const msgs = [{ role: 'system', content: systemPrompt }].concat(sliced);
      let reply = this.groqKey
        ? await this.callGroq(msgs)
        : await this.callOpenRouter(systemPrompt + '\n\nUser: ' + lastText);

      // Safety net: if model still says n/a but we have liq
      if (
        tok.liquidity != null &&
        /liquidity[^\n]{0,40}(n\/a|неизвестн|unknown)/i.test(reply)
      ) {
        const liqStr = Math.round(tok.liquidity).toLocaleString('en-US');
        reply =
          (lang === 'en'
            ? '1) Contract — data from scan (see flags)\n2) Liquidity — $' +
              liqStr +
              ' USD\n'
            : '1) Contract — по данным скана (см. flags)\n2) Liquidity — $' +
              liqStr +
              ' USD\n') + reply;
      }

      if (!hasScan) {
        reply =
          (lang === 'en'
            ? 'No scan snapshot was attached. Open a token report first.\n\n'
            : 'Нет данных скана в запросе. Сначала откройте отчёт токена.\n\n') + reply;
      }

      return { reply, demo: false };
    } catch (e) {
      console.error('AI chat error:', e.message);
      return {
        reply: this.chatFallback(
          lastText,
          tok,
          { riskScore, riskLevel, reasons },
          meta,
          lang
        ),
        demo: true
      };
    }
  }

  chatFallback(lastText, tok, risk, meta, lang) {
    lang = lang === 'en' ? 'en' : 'ru';
    const score = Number(risk.riskScore) || 50;
    const liq = Number(tok.liquidity) || 0;
    const top = meta.top10Pct;
    const band = (n) => (n <= 30 ? 'LOW' : n <= 60 ? 'MEDIUM' : 'HIGH');
    const contract = meta.isHoneypot || meta.isMintable ? 75 : 30;
    const liquidity = liq < 50000 ? 80 : liq < 200000 ? 50 : 25;
    const holders = top != null && top >= 50 ? 75 : top != null && top >= 30 ? 45 : 30;
    const trading = meta.sellTax != null && meta.sellTax > 10 ? 70 : 30;
    return (
      'Based on current data:\n' +
      'Contract: ' +
      band(contract) +
      '\nLiquidity: ' +
      band(liquidity) +
      '\nHolders: ' +
      band(holders) +
      '\nWhales: ' +
      band(holders) +
      '\nTrading: ' +
      band(trading) +
      '\n\nMy analysis\n' +
      (tok.symbol || 'Token') +
      ' · risk ' +
      score +
      '/100. ' +
      (meta.isHoneypot
        ? 'Есть honeypot-флаг — продажа может быть ограничена. '
        : '') +
      (liq < 100000 ? 'Ликвидность ограничена для крупного размера. ' : '') +
      (top != null && top >= 50 ? 'Высокая концентрация холдеров. ' : '') +
      'Это разбор рисков, не рекомендация к сделке.\n\n' +
      'What would change my assessment?\n' +
      'Если ликвидность вырастет существенно и top-10 концентрация снизится (и исчезнут honeypot/mint flags), общий риск снизится.\n\n' +
      'Вы спросили: «' +
      (lastText || '') +
      '»'
    );
  }
}

module.exports = new AIService();
