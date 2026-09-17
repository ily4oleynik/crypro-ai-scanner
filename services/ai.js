const axios = require('axios');

class AIService {
  constructor() {
    this.groqKey = process.env.GROQ_API_KEY || '';
    this.groqURL = 'https://api.groq.com/openai/v1';
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    console.log('[AI] GROQ_API_KEY loaded:', this.groqKey ? 'YES' : 'NO');
  }

  /**
   * @param {object} tokenData
   * @param {object} riskReport
   * @param {string} plan - free | premium | pro
   */
  async analyzeToken(tokenData, riskReport, plan = 'free') {
    const p = String(plan || 'free').toLowerCase();
    const symbol = tokenData?.symbol || 'TOKEN';
    const name = tokenData?.name || '';
    const price = tokenData?.price ?? '—';
    const liq = tokenData?.liquidity ?? '—';
    const vol = tokenData?.volume24h ?? '—';
    const fdv = tokenData?.fdv ?? tokenData?.marketCap ?? '—';
    const riskScore = riskReport?.riskScore ?? 50;
    const riskLevel = riskReport?.riskLevel || 'MEDIUM';

    if (!this.groqKey) {
      return this.fallbackAnalysis(symbol, riskScore, riskLevel, p);
    }

    try {
      const prompt =
        p === 'free'
          ? this.buildFreePrompt(symbol, name, price, riskScore, riskLevel)
          : this.buildPremiumPrompt(symbol, name, price, liq, vol, fdv, riskScore, riskLevel, p);

      const reply = await this.callGroq([{ role: 'user', content: prompt }]);
      return this.parseAnalysis(reply, riskScore, riskLevel, p);
    } catch (e) {
      console.error('Groq analyze error:', e.response?.data || e.message);
      return this.fallbackAnalysis(symbol, riskScore, riskLevel, p);
    }
  }

  buildFreePrompt(symbol, name, price, riskScore, riskLevel) {
    return (
      `Ты крипто-аналитик. Коротко на русском, без markdown, без списков из 10 пунктов.\n` +
      `Токен: ${symbol} ${name ? '(' + name + ')' : ''}, цена $${price}, ` +
      `риск ${riskScore}/100 (${riskLevel}).\n` +
      `Дай 2–3 предложения: общий тон риска и одну главную осторожность. ` +
      `В конце одна фраза-вердикт. Не финансовый совет, DYOR.`
    );
  }

  buildPremiumPrompt(symbol, name, price, liq, vol, fdv, riskScore, riskLevel, plan) {
    const depth =
      plan === 'pro'
        ? `Добавь блок «Что проверить дальше» (3 пункта: холдеры, локи ликвидности, активность деплоера — как гипотезы, не факты).`
        : `Без воды, по делу.`;

    return (
      `Ты senior on-chain / token risk аналитик. Ответ СТРОГО на русском. Без markdown (# * \`).\n\n` +
      `Данные токена:\n` +
      `- Символ: ${symbol}\n` +
      `- Название: ${name || '—'}\n` +
      `- Цена: $${price}\n` +
      `- Ликвидность: ${liq}\n` +
      `- Объём 24ч: ${vol}\n` +
      `- FDV/Market Cap: ${fdv}\n` +
      `- Risk score: ${riskScore}/100 (${riskLevel})\n\n` +
      `Структура ответа (соблюдай порядок, заголовки обычным текстом):\n` +
      `1) Краткий вывод — 2 предложения\n` +
      `2) Ключевые риски — 3–5 коротких пунктов с дефисом\n` +
      `3) Позитивные сигналы — 2–4 пункта с дефисом\n` +
      `4) На что смотреть перед входом — 2–3 пункта\n` +
      `5) Вердикт — одна фраза\n\n` +
      `${depth}\n` +
      `Не выдумывай аудит, team wallet и lock, если их нет в данных. ` +
      `Не давай прямых указаний «покупай/продавай». Упомяни DYOR.`
    );
  }

  parseAnalysis(text, riskScore, riskLevel, plan) {
    const clean = String(text || '')
      .replace(/[#*`]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const risks = [];
    const positives = [];
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);

    let section = '';
    for (const line of lines) {
      const low = line.toLowerCase();
      if (low.includes('ключев') && low.includes('риск')) {
        section = 'risks';
        continue;
      }
      if (low.includes('позитив')) {
        section = 'positives';
        continue;
      }
      if (low.includes('вердикт')) {
        section = 'verdict';
        continue;
      }
      if (line.startsWith('-') || line.startsWith('•') || line.startsWith('–')) {
        const item = line.replace(/^[-•–]\s*/, '');
        if (section === 'risks') risks.push(item);
        if (section === 'positives') positives.push(item);
      }
    }

    let verdict = 'Нейтрально · DYOR';
    const vLine = lines.find((l) => l.toLowerCase().includes('вердикт'));
    if (vLine) {
      verdict = vLine.replace(/вердикт\s*:?\s*/i, '').trim() || verdict;
    } else if (lines.length) {
      verdict = lines[lines.length - 1].slice(0, 160);
    }

    const confidence =
      plan === 'pro' ? 88 : plan === 'premium' ? 78 : 58;

    return {
      text: clean,
      confidence,
      risks: risks.slice(0, 6),
      positives: positives.slice(0, 6),
      verdict,
      plan
    };
  }

  fallbackAnalysis(symbol, riskScore, riskLevel, plan) {
    if (plan === 'free') {
      return {
        text:
          `Краткий взгляд на ${symbol}: риск около ${riskScore}/100 (${riskLevel}). ` +
          `На Free доступен сжатый вердикт; полный разбор Security и AI — в Premium. DYOR.`,
        confidence: 55,
        risks: ['Ограниченные данные на тарифе Free'],
        positives: [],
        verdict: 'Нужен более глубокий разбор',
        plan
      };
    }
    return {
      text:
        `Анализ ${symbol}: предварительный риск ${riskScore}/100 (${riskLevel}). ` +
        `AI временно недоступен (нет ключа или сбой провайдера). ` +
        `Проверь ликвидность, объём и контракт вручную. DYOR.`,
      confidence: 50,
      risks: ['AI fallback — данные ограничены'],
      positives: [],
      verdict: 'Нейтрально · проверь вручную',
      plan
    };
  }

  async chat(messages, context = {}) {
    context = context || {};
    const last = (messages || []).filter((m) => m.role === 'user').pop();
    const lastText = last ? last.content : '';

    if (!this.groqKey) {
      return {
        reply:
          'Демо-режим AI. Ключ GROQ_API_KEY не найден.\n' +
          'Вы написали: «' +
          lastText +
          '»\nТокен: ' +
          ((context.token && context.token.symbol) || 'не выбран') +
          '\nДобавь GROQ_API_KEY в переменные окружения.',
        demo: true
      };
    }

    try {
      const symbol = (context.token && context.token.symbol) || 'не выбран';
      const risk = (context.risk && context.risk.riskScore) || '—';
      const systemPrompt =
        'Ты крипто-аналитик в продукте Crypto AI Scanner. Отвечай на русском просто, без markdown. ' +
        'Токен в контексте: ' +
        symbol +
        ', Risk: ' +
        risk +
        '. Не давай прямых финансовых советов (не говори «покупай/продавай»). ' +
        'Если данных мало — скажи об этом. Всегда напоминай DYOR коротко.';

      const reply = await this.callGroq(
        [{ role: 'system', content: systemPrompt }].concat((messages || []).slice(-10))
      );
      return { reply, demo: false };
    } catch (e) {
      console.error('Groq chat error:', e.response?.data || e.message);
      return {
        reply:
          'Ошибка Groq: ' +
          ((e.response && e.response.data && e.response.data.error && e.response.data.error.message) ||
            e.message) +
          '\nПопробуйте позже.',
        demo: true
      };
    }
  }

  async callGroq(messages) {
    const response = await axios.post(
      this.groqURL + '/chat/completions',
      {
        model: this.groqModel,
        messages,
        temperature: 0.55,
        max_tokens: 900
      },
      {
        headers: {
          Authorization: 'Bearer ' + this.groqKey,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    let text = response.data.choices[0].message.content.trim();
    text = text.replace(/[#*`_]/g, '').replace(/\n{3,}/g, '\n\n');
    return text;
  }
}

module.exports = new AIService();
