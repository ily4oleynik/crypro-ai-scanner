const axios = require('axios');

class AIService {
  constructor() {
    this.groqKey = process.env.GROQ_API_KEY || '';
    this.groqURL = 'https://api.groq.com/openai/v1';
    this.groqModel = 'llama-3.3-70b-versatile';
    console.log('[AI] GROQ_API_KEY loaded:', this.groqKey ? 'YES' : 'NO');
  }

  async analyzeToken(tokenData, riskReport) {
    if (this.groqKey) {
      try {
        const prompt = this.buildSimplePrompt(tokenData, riskReport);
        const reply = await this.callGroq([{ role: 'user', content: prompt }]);
        return {
          text: reply,
          confidence: 82,
          risks: [],
          positives: [],
          verdict: this.determineVerdict(reply)
        };
      } catch (e) {
        console.error('Groq analyze error:', e.message);
      }
    }
    return this.generateFallbackAnalysis(tokenData, riskReport);
  }

  buildSimplePrompt(tokenData, riskReport) {
    return `Ты — старший крипто-аналитик. Пиши на русском, просто и по делу, без markdown, без звёздочек.

ДАННЫЕ ТОКЕНА:
- Символ: ${tokenData.symbol || 'N/A'}
- Название: ${tokenData.name || 'N/A'}
- Цена: $${tokenData.price || 'N/A'}
- Ликвидность: $${tokenData.liquidity || 0}
- Объём 24ч: $${tokenData.volume24h || 0}
- FDV / Market Cap: $${tokenData.fdv || tokenData.marketCap || 0}
- Risk Score: ${riskReport?.riskScore || 50}/100 (${riskReport?.riskLevel || 'MEDIUM'})

СТРУКТУРА ОТВЕТА (строго):
1) Краткий вердикт (1 предложение)
2) Что выглядит хорошо (2–3 пункта)
3) Главные риски (2–3 пункта)
4) Для кого может подойти / не подойти
5) Итог: стоит ли рассматривать вход (с оговоркой DYOR)

Не обещай доходность. Не давай прямых финансовых советов. Максимум 280 слов.`;
  }

  generateFallbackAnalysis(tokenData, riskReport) {
    const score = riskReport?.riskScore || 50;
    let verdict = 'Нейтрально';
    if (score > 75) verdict = 'Выглядит относительно надёжно';
    else if (score < 40) verdict = 'Высокий риск';

    return {
      text: `Анализ ${tokenData.symbol || 'токена'}: ${verdict}. Риск ${score}/100. Всегда делай собственное исследование (DYOR).`,
      confidence: 60,
      risks: [],
      positives: [],
      verdict
    };
  }

  determineVerdict(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('стоит') || t.includes('хорошо') || t.includes('можно')) return 'Покупка возможна';
    if (t.includes('опасно') || t.includes('высокий риск') || t.includes('лучше пройти')) return 'Высокий риск';
    return 'Нейтрально';
  }

  async chat(messages, context = {}) {
    const lastMessage = (messages || []).filter(m => m.role === 'user').pop()?.content || '';

    if (!this.groqKey) {
      return {
        reply: `Демо-режим. Ключ GROQ_API_KEY не найден.\nВы написали: «${lastMessage}»\nТокен: ${context?.token?.symbol || 'не выбран'}\nДобавь GROQ_API_KEY в backend/.env`,
        demo: true
      };
    }

    try {
      const systemPrompt = `Ты — AI-ассистент Crypto AI Scanner, опытный крипто-аналитик.
Отвечай на русском, коротко и ясно, без markdown.
Контекст: токен ${context?.token?.symbol || 'не выбран'}, Risk ${context?.risk?.riskScore || '—'}/100.
Правила:
- Не давай прямых советов «покупай/продавай»
- Всегда упоминай риски и DYOR
- Если данных мало — честно говори об этом
- Структура: сначала суть, потом детали`;

      const reply = await this.callGroq([
        { role: 'system', content: systemPrompt },
        ...(messages || []).slice(-10)
      ]);
      return { reply, demo: false };
    } catch (e) {
      console.error('Groq chat error:', e.response?.data || e.message);
      return {
        reply: `Ошибка Groq: ${e.response?.data?.error?.message || e.message}\nПопробуйте позже.`,
        demo: true
      };
    }
  }

  async callGroq(messages) {
    const response = await axios.post(`${this.groqURL}/chat/completions`, {
      model: this.groqModel,
      messages,
      temperature: 0.7,
      max_tokens: 600
    }, {
      headers: {
        'Authorization': `Bearer ${this.groqKey}`,
        'Content-Type': 'application/json'
      }
    });

    let text = response.data.choices[0].message.content.trim();
    text = text.replace(/[#*`_]/g, '').replace(/\n{3,}/g, '\n\n');
    return text;
  }
}

module.exports = new AIService();