// services/scoring.js
const { subDays, differenceInDays } = require('date-fns');

class RiskEngine {
  constructor() {
    this.weights = {
      liquidity: 0.15,
      volume: 0.12,
      fdv: 0.10,
      marketCap: 0.10,
      age: 0.08,
      volatility: 0.12,
      whaleConcentration: 0.10,
      buySellRatio: 0.08,
      devWallet: 0.05,
      contractVerified: 0.05,
      liquidityLock: 0.05,
      holderCount: 0.05,
      socialTrust: 0.05
    };
  }

  safeNumber(value, fallback = 0) {
    if (typeof value === 'number' && !isNaN(value)) return value;
    return fallback;
  }

  calculateAge(createdAt) {
    if (!createdAt) return { days: 30, score: 50, confidence: 60 };
    const days = differenceInDays(new Date(), new Date(createdAt));
    const score = Math.min(100, Math.max(20, 100 - (days / 3)));
    return { days, score, confidence: days > 0 ? 80 : 40 };
  }

  calculateVolatility(priceHistory = []) {
    if (priceHistory.length < 5) return { value: 45, score: 65, confidence: 50 };
    const changes = [];
    for (let i = 1; i < priceHistory.length; i++) {
      const change = Math.abs((priceHistory[i] - priceHistory[i-1]) / priceHistory[i-1]) * 100;
      changes.push(change);
    }
    const avgVol = changes.reduce((a, b) => a + b, 0) / changes.length;
    const score = Math.max(10, Math.min(95, 100 - avgVol * 1.5));
    return { value: avgVol.toFixed(2), score, confidence: 75 };
  }

  calculateWhaleConcentration(topHolders = [], totalSupply) {
    if (!topHolders.length || !totalSupply) return { percent: 0, score: 70, confidence: 40 };
    const top10Percent = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.balance || 0), 0) / totalSupply * 100;
    const score = top10Percent > 60 ? 25 : top10Percent > 40 ? 45 : 75;
    return { percent: top10Percent.toFixed(1), score, confidence: topHolders.length > 5 ? 70 : 45 };
  }

  calculateRiskScore(tokenData) {
    const {
      liquidity = 0,
      volume24h = 0,
      fdv = 0,
      marketCap = 0,
      createdAt,
      priceHistory = [],
      topHolders = [],
      totalSupply,
      buySellRatio = 1,
      isVerified = false,
      liquidityLocked = false,
      holderCount = 0,
      socialScore = 50,
      devWalletRisk = 50
    } = tokenData;

    const factors = {};

    factors.liquidity = { score: liquidity > 50000 ? 85 : liquidity > 10000 ? 65 : 35, confidence: liquidity > 0 ? 80 : 50 };
    factors.volume = { score: volume24h > 100000 ? 90 : volume24h > 20000 ? 70 : 40, confidence: volume24h > 0 ? 75 : 45 };
    factors.fdv = { score: fdv < 5000000 ? 75 : fdv < 50000000 ? 55 : 40, confidence: fdv > 0 ? 70 : 40 };
    factors.marketCap = { score: marketCap > 1000000 ? 80 : marketCap > 100000 ? 60 : 40, confidence: marketCap > 0 ? 70 : 40 };

    const ageData = this.calculateAge(createdAt);
    factors.age = { score: ageData.score, confidence: ageData.confidence };

    const volData = this.calculateVolatility(priceHistory);
    factors.volatility = volData;

    const whaleData = this.calculateWhaleConcentration(topHolders, totalSupply);
    factors.whaleConcentration = whaleData;

    factors.buySellRatio = { score: buySellRatio > 1.5 ? 85 : buySellRatio > 0.8 ? 65 : 35, confidence: 60 };
    factors.contractVerified = { score: isVerified ? 90 : 45, confidence: 85 };
    factors.liquidityLock = { score: liquidityLocked ? 85 : 50, confidence: 70 };
    factors.devWallet = { score: Math.max(20, 100 - devWalletRisk), confidence: 65 };
    factors.holderCount = { score: holderCount > 1000 ? 80 : holderCount > 100 ? 60 : 40, confidence: 55 };
    factors.socialTrust = { score: this.safeNumber(socialScore, 50), confidence: 60 };

    let totalScore = 0;
    let totalWeight = 0;
    let totalConfidence = 0;

    Object.keys(this.weights).forEach(key => {
      const factor = factors[key] || { score: 50, confidence: 50 };
      totalScore += factor.score * this.weights[key];
      totalWeight += this.weights[key];
      totalConfidence += factor.confidence * this.weights[key];
    });

    const riskScore = Math.round(totalScore / totalWeight);
    const overallConfidence = Math.round(totalConfidence / totalWeight);

    return {
      riskScore: Math.max(10, Math.min(95, riskScore)),
      confidence: overallConfidence,
      factors,
      riskLevel: riskScore > 75 ? 'LOW' : riskScore > 50 ? 'MEDIUM' : 'HIGH'
    };
  }

  generatePremiumReport(tokenData, aiSummary = {}) {
    return {
      projectLinks: {
        website: tokenData.website || null,
        twitter: tokenData.twitter || null,
      },
      community: { communityScore: tokenData.socialScore || 50 },
      security: { scamProbability: 25 },
      market: { volume: tokenData.volume24h },
      ai: {
        confidence: aiSummary.confidence || 70,
        summary: aiSummary.text || 'Анализ в процессе...'
      }
    };
  }
}

module.exports = new RiskEngine();