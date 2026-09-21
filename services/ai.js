const axios = require('axios');

class AIService {
  constructor() {
    this.groqKey = process.env.GROQ_API_KEY || '';
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    this.groqURL = 'https://api.groq.com/openai/v1';
    this.groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
    this.groqModel = this.groqModels[0];
    this.orURL = 'https://openrouter.ai/api/v1';
    console.log('[AI] GROQ_API_KEY loaded:', this.groqKey ? 'YES' : 'NO');
  }

  async analyzeToken(tokenData, riskReport) {
    const td = tokenData || {};
    const rr = riskReport || {};
    try {
      const prompt = this.buildPrompt(td, rr);
      let text = null;
      if (this.groqKey) {
        text = await this.callGroq([{ role: 'user', content: prompt }]);
      } else if (this.openRouterKey && this.openRouterKey !== 'dummy-key-for-dev') {
        text = await this.callOpenRouter(prompt);
      }
      if (text) {
        return {
          text,
          confidence: 78,
          risks: this.pickRisks(td, rr),
          positives: this.pickPositives(td, rr),
          verdict: this.verdictFromScore(rr.riskScore)
        };
      }
    } catch (e) {
      console.error('AI analyze error:', e.message);
    }
    return this.generateFallbackAnalysis(td, rr);
  }

  buildPrompt(td, rr) {
    return `Ты крипто-риск аналитик. Ответь на русском, без markdown, 180-280 слов.
Токен: ${td.symbol || '?'} (${td.name || ''})
Цена: $${td.price || 'n/a'}
Риск-скор: ${rr.riskScore || '?'}/100 (${rr.riskLevel || ''})
Ликвидность: $${td.liquidity || 0}
Объём 24ч: $${td.volume24h || 0}
Market Cap/FDV: $${td.marketCap || td.fdv || 'n/a'}
Структура ответа:
1) Короткий вердикт одной фразой
2) Почему такой risk score (2-4 конкретные причины)
3) Что проверить до покупки
4) Чего не хватает в данных
Не давай финансовых советов "покупай/продавай". DYOR.`;
  }

  async callGroq(messages) {
    const models = this.groqModels || [this.groqModel || 'llama-3.1-8b-instant'];
    let lastErr = null;
    for (const model of models) {
      try {
        const response = await axios.post(
          this.groqURL + '/chat/completions',
          { model: model, messages: messages, temperature: 0.5, max_tokens: 700 },
          { headers: { Authorization: 'Bearer ' + this.groqKey, 'Content-Type': 'application/json' } }
        );
        this.groqModel = model;
        let text = response.data.choices[0].message.content.trim();
        return text.replace(/[#*_`]/g, '').replace(/\n{3,}/g, '\n\n');
      } catch (e) {
        lastErr = e;
        const status = e.response && e.response.status;
        console.error('[AI] Groq', model, status || e.message);
        if (status && status !== 404 && status !== 400) break;
      }
    }
    throw lastErr || new Error('Groq failed');
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
    if (s >= 70) return 'High risk';
    if (s >= 40) return 'Cautious OK';
    return 'Lower risk';
  }

  pickRisks(td, rr) {
    const risks = [];
    const liq = Number(td.liquidity) || 0;
    const vol = Number(td.volume24h) || 0;
    if (liq < 50000) risks.push('Thin liquidity — exits may slip heavily');
    if (vol < 10000) risks.push('Low 24h volume — price discovery is weak');
    if ((Number(rr.riskScore) || 0) >= 60) risks.push('Elevated composite risk score');
    if (!risks.length) risks.push('Residual smart-contract and market risk always remains');
    return risks.slice(0, 4);
  }

  pickPositives(td, rr) {
    const pos = [];
    const liq = Number(td.liquidity) || 0;
    const vol = Number(td.volume24h) || 0;
    if (liq >= 100000) pos.push('Liquidity supports reasonable trade size');
    if (vol >= 50000) pos.push('Active 24h trading volume');
    if ((Number(rr.riskScore) || 100) < 45) pos.push('Composite score in a milder band');
    if (!pos.length) pos.push('Pair data available from the market feed');
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
      verdict
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
