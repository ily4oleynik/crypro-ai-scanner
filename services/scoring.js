/**
 * Risk 0–100: выше = опаснее
 */
function computeRiskFromPair(pair, base) {
  let score = 40; // база
  const reasons = [];

  const liq = Number(base.liquidity || pair?.liquidity?.usd || 0);
  const vol = Number(base.volume24h || pair?.volume?.h24 || 0);
  const fdv = Number(base.fdv || pair?.fdv || 0);
  const priceChange = Number(pair?.priceChange?.h24 || 0);
  const txns = (pair?.txns?.h24?.buys || 0) + (pair?.txns?.h24?.sells || 0);
  const hasSocial = !!(base.website || base.twitter || base.telegram);
  const hasImage = !!pair?.info?.imageUrl;

  // Ликвидность
  if (liq < 5000) {
    score += 25;
    reasons.push('Очень низкая ликвидность');
  } else if (liq < 25000) {
    score += 15;
    reasons.push('Низкая ликвидность');
  } else if (liq < 100000) {
    score += 5;
  } else if (liq > 500000) {
    score -= 8;
    reasons.push('Нормальная ликвидность');
  }

  // Объём 24ч
  if (vol < 1000) {
    score += 12;
    reasons.push('Почти нет объёма');
  } else if (vol < 10000) {
    score += 6;
  } else if (vol > 100000) {
    score -= 5;
  }

  // Отношение FDV к ликвидности (раздутый FDV)
  if (liq > 0 && fdv > 0) {
    const ratio = fdv / liq;
    if (ratio > 50) {
      score += 18;
      reasons.push('FDV сильно выше ликвидности');
    } else if (ratio > 20) {
      score += 10;
      reasons.push('Высокий FDV относительно пула');
    }
  }

  // Резкий памп/дамп за 24ч
  if (Math.abs(priceChange) > 80) {
    score += 12;
    reasons.push('Экстремальная волатильность 24ч');
  } else if (Math.abs(priceChange) > 40) {
    score += 6;
  }

  // Активность
  if (txns < 10) {
    score += 8;
    reasons.push('Мало сделок за 24ч');
  } else if (txns > 200) {
    score -= 4;
  }

  // Соцсигналы (слабый плюс, не гарантия)
  if (!hasSocial && !hasImage) {
    score += 8;
    reasons.push('Мало публичной информации');
  } else if (hasSocial) {
    score -= 4;
  }

  // Клампа
  score = Math.max(5, Math.min(95, Math.round(score)));

  let riskLevel = 'MEDIUM';
  if (score >= 70) riskLevel = 'HIGH';
  else if (score <= 35) riskLevel = 'LOW';

  return {
    riskScore: score,
    riskLevel,
    confidence: hasSocial ? 72 : 58,
    reasons: reasons.slice(0, 6)
  };
}

module.exports = { computeRiskFromPair };
