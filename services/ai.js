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

  async analyzeToken(tokenData, riskReport, plan) {
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

  async chat(messages, context) {
    context = context || {};
    const last = (messages || []).filter(m => m.role === 'user').pop();
    const lastText = last ? last.content : '';
    if (!this.groqKey && !this.openRouterKey) {
      return {
        reply:
          'Демо-режим чата. Ключ API не найден.\nВы написали: «' +
          lastText +
          '»\nТокен: ' +
          ((context.token && context.token.symbol) || 'не выбран') +
          '\nДобавьте GROQ_API_KEY в env.',
        demo: true
      };
    }
    try {
      const systemPrompt =
        'Ты крипто-аналитик. Отвечай на русском коротко, без markdown. Не давай прямых финансовых советов. Токен: ' +
        ((context.token && context.token.symbol) || 'n/a') +
        ', Risk: ' +
        ((context.risk && context.risk.riskScore) || '—');
      const msgs = [{ role: 'system', content: systemPrompt }].concat((messages || []).slice(-10));
      const reply = this.groqKey ? await this.callGroq(msgs) : await this.callOpenRouter(systemPrompt + '\n\n' + lastText);
      return { reply, demo: false };
    } catch (e) {
      console.error('AI chat error:', e.message);
      return { reply: 'Ошибка AI: ' + e.message, demo: true };
    }
  }
}

module.exports = new AIService();
