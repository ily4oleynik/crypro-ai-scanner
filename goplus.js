/**
 * GoPlus Token Security integration
 * Docs: https://docs.gopluslabs.io/reference/tokensecurityusingget_1
 * Public endpoint works with rate limits; optional GOPLUS_API_KEY as Bearer.
 */
const axios = require('axios');

const CHAIN_IDS = {
  ethereum: '1',
  eth: '1',
  bsc: '56',
  bnbt: '56',
  'bnb chain': '56',
  polygon: '137',
  matic: '137',
  arbitrum: '42161',
  optimism: '10',
  base: '8453',
  avalanche: '43114',
  avax: '43114',
  fantom: '250',
  cronos: '25',
  zkSync: '324',
  zksync: '324',
  linea: '59144',
  scroll: '534352',
  mantle: '5000',
  blast: '81457',
  // Tron (GoPlus chain list)
  tron: '728126428'
};

function resolveChainId(chainIdOrName) {
  if (chainIdOrName == null || chainIdOrName === '') return null;
  const s = String(chainIdOrName).toLowerCase().trim();
  if (/^\d+$/.test(s)) return s;
  return CHAIN_IDS[s] || null;
}

function yn(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return null;
}

function pct(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  // GoPlus often returns 0.01 = 1%
  if (n > 0 && n <= 1) return Math.round(n * 10000) / 100;
  return Math.round(n * 100) / 100;
}

/**
 * Normalize GoPlus raw result into UI-friendly flags
 */
function normalizeSecurity(raw, chainId) {
  if (!raw || typeof raw !== 'object') {
    return { available: false, chainId, flags: [], raw: null };
  }

  const isOpenSource = yn(raw.is_open_source);
  const isProxy = yn(raw.is_proxy);
  const isMintable = yn(raw.is_mintable);
  const ownerRenounced =
    yn(raw.is_honeypot) === null
      ? null
      : String(raw.owner_address || '').toLowerCase() ===
          '0x0000000000000000000000000000000000000000' ||
        String(raw.owner_address || '') === '' ||
        yn(raw.can_take_back_ownership) === false && yn(raw.owner_change_balance) === false
          ? null
          : null;

  // Ownership: empty/zero address often means renounced
  const owner = String(raw.owner_address || '').toLowerCase();
  const renounced =
    !owner ||
    owner === '0x0000000000000000000000000000000000000000' ||
    owner === '0x000000000000000000000000000000000000dead';

  const isHoneypot = yn(raw.is_honeypot);
  const cannotBuy = yn(raw.cannot_buy);
  const cannotSellAll = yn(raw.cannot_sell_all);
  const transferPausable = yn(raw.transfer_pausable);
  const isBlacklisted = yn(raw.is_blacklisted);
  const isWhitelisted = yn(raw.is_whitelisted);
  const hiddenOwner = yn(raw.hidden_owner);
  const canTakeBack = yn(raw.can_take_back_ownership);
  const buyTax = pct(raw.buy_tax);
  const sellTax = pct(raw.sell_tax);
  const isInDex = yn(raw.is_in_dex);
  const holderCount = raw.holder_count != null ? Number(raw.holder_count) : null;
  const lpHolderCount = raw.lp_holder_count != null ? Number(raw.lp_holder_count) : null;

  // Top holders concentration
  let top10Pct = null;
  if (Array.isArray(raw.holders) && raw.holders.length) {
    top10Pct = raw.holders.slice(0, 10).reduce((s, h) => s + (Number(h.percent) || 0), 0);
    if (top10Pct <= 1) top10Pct = top10Pct * 100;
    top10Pct = Math.round(top10Pct * 10) / 10;
  }

  // LP lock / burn from lp_holders if present
  let lpLockedPct = null;
  let lpBurned = false;
  if (Array.isArray(raw.lp_holders) && raw.lp_holders.length) {
    let locked = 0;
    let burned = 0;
    raw.lp_holders.forEach((h) => {
      const p = Number(h.percent) || 0;
      const pctVal = p <= 1 ? p * 100 : p;
      const addr = String(h.address || '').toLowerCase();
      const isBurn =
        addr.includes('dead') ||
        addr === '0x0000000000000000000000000000000000000000' ||
        addr === '0x000000000000000000000000000000000000dead';
      if (isBurn || h.is_locked === true || h.is_locked === 1 || h.is_locked === '1') {
        locked += pctVal;
        if (isBurn) burned += pctVal;
      }
    });
    if (locked > 0) lpLockedPct = Math.round(Math.min(100, locked) * 10) / 10;
    lpBurned = burned >= 50;
  }

  const flags = [
    {
      id: 'verified',
      label: 'Contract verified',
      status: isOpenSource === true ? 'ok' : isOpenSource === false ? 'bad' : 'warn',
      text:
        isOpenSource === true
          ? 'Source code verified'
          : isOpenSource === false
            ? 'Source not verified'
            : 'Unknown'
    },
    {
      id: 'proxy',
      label: 'Proxy',
      status: isProxy === true ? 'warn' : isProxy === false ? 'ok' : 'warn',
      text: isProxy === true ? 'Proxy contract (upgradeable)' : isProxy === false ? 'Not a proxy' : 'Unknown'
    },
    {
      id: 'mint',
      label: 'Mint',
      status: isMintable === true ? 'bad' : isMintable === false ? 'ok' : 'warn',
      text: isMintable === true ? 'Mint function present' : isMintable === false ? 'No mint detected' : 'Unknown'
    },
    {
      id: 'ownership',
      label: 'Ownership',
      status: renounced ? 'ok' : canTakeBack === true || hiddenOwner === true ? 'bad' : 'warn',
      text: renounced
        ? 'Owner renounced / zero'
        : hiddenOwner
          ? 'Hidden owner'
          : canTakeBack
            ? 'Owner can reclaim control'
            : owner
              ? 'Owner set — review'
              : 'Unknown'
    },
    {
      id: 'honeypot',
      label: 'Honeypot',
      status: isHoneypot === true || cannotSellAll === true ? 'bad' : isHoneypot === false ? 'ok' : 'warn',
      text:
        isHoneypot === true
          ? 'Flagged as honeypot'
          : cannotSellAll
            ? 'Cannot sell all'
            : isHoneypot === false
              ? 'No honeypot flag'
              : 'Not simulated fully'
    },
    {
      id: 'trading',
      label: 'Trading',
      status: cannotBuy === true || transferPausable === true ? 'bad' : 'ok',
      text: cannotBuy
        ? 'Buying restricted'
        : transferPausable
          ? 'Transfers pausable'
          : isInDex
            ? 'Listed on DEX'
            : 'Check liquidity'
    },
    {
      id: 'tax',
      label: 'Buy / Sell tax',
      status:
        (buyTax != null && buyTax > 10) || (sellTax != null && sellTax > 10)
          ? 'bad'
          : (buyTax != null && buyTax > 5) || (sellTax != null && sellTax > 5)
            ? 'warn'
            : buyTax != null || sellTax != null
              ? 'ok'
              : 'warn',
      text:
        buyTax != null || sellTax != null
          ? `Buy ${buyTax != null ? buyTax + '%' : '—'} / Sell ${sellTax != null ? sellTax + '%' : '—'}`
          : 'Tax unknown'
    },
    {
      id: 'blacklist',
      label: 'Blacklist',
      status: isBlacklisted === true ? 'bad' : isBlacklisted === false ? 'ok' : 'warn',
      text: isBlacklisted === true ? 'Has blacklist' : isBlacklisted === false ? 'No blacklist' : 'Unknown'
    },
    {
      id: 'holders',
      label: 'Holders',
      status:
        top10Pct != null && top10Pct >= 70
          ? 'bad'
          : top10Pct != null && top10Pct >= 50
            ? 'warn'
            : top10Pct != null
              ? 'ok'
              : 'warn',
      text:
        holderCount != null
          ? `${holderCount.toLocaleString()} holders` +
            (top10Pct != null ? ` · top10 ~${top10Pct}%` : '')
          : top10Pct != null
            ? `Top10 ~${top10Pct}%`
            : 'Holder data limited'
    },
    {
      id: 'lp',
      label: 'LP lock / burn',
      status:
        lpBurned || (lpLockedPct != null && lpLockedPct >= 80)
          ? 'ok'
          : lpLockedPct != null && lpLockedPct >= 30
            ? 'warn'
            : lpLockedPct != null
              ? 'bad'
              : 'warn',
      text: lpBurned
        ? 'Majority LP burned'
        : lpLockedPct != null
          ? `~${lpLockedPct}% LP locked/burned`
          : 'LP lock unknown — check explorer'
    }
  ];

  // Risk contribution from on-chain
  let riskBonus = 0;
  if (isHoneypot) riskBonus += 35;
  if (cannotSellAll) riskBonus += 20;
  if (isMintable) riskBonus += 12;
  if (hiddenOwner || canTakeBack) riskBonus += 10;
  if (isOpenSource === false) riskBonus += 8;
  if (sellTax != null && sellTax > 10) riskBonus += 15;
  if (top10Pct != null && top10Pct > 70) riskBonus += 12;
  if (lpLockedPct != null && lpLockedPct < 20) riskBonus += 8;

  return {
    available: true,
    chainId,
    source: 'goplus',
    flags,
    riskBonus,
    meta: {
      isOpenSource,
      isProxy,
      isMintable,
      renounced,
      isHoneypot,
      cannotSellAll,
      buyTax,
      sellTax,
      holderCount,
      top10Pct,
      lpLockedPct,
      lpBurned,
      owner: raw.owner_address || null,
      creator: raw.creator_address || null
    },
    raw
  };
}

async function fetchTokenSecurity(chainIdOrName, contractAddress) {
  const address = String(contractAddress || '').trim();
  if (!address) {
    return { available: false, error: 'No address', flags: [] };
  }

  // Solana uses a different endpoint
  const chainKey = String(chainIdOrName || '').toLowerCase();
  if (chainKey === 'solana' || chainKey === 'sol') {
    return fetchSolanaSecurity(address);
  }

  const chainId = resolveChainId(chainIdOrName);
  if (!chainId) {
    return {
      available: false,
      error: 'Unsupported chain for GoPlus',
      chainId: chainIdOrName,
      flags: []
    };
  }

  // Tron addresses are base58 — GoPlus may still accept for tron chain id
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}`;
  const headers = { Accept: 'application/json' };
  if (process.env.GOPLUS_API_KEY) {
    headers.Authorization = 'Bearer ' + process.env.GOPLUS_API_KEY;
  }

  try {
    const res = await axios.get(url, {
      params: { contract_addresses: address.toLowerCase().startsWith('0x') ? address.toLowerCase() : address },
      headers,
      timeout: 12000
    });
    const body = res.data || {};
    if (body.code !== 1 && body.code !== '1' && body.result == null) {
      return {
        available: false,
        error: body.message || 'GoPlus empty',
        chainId,
        flags: []
      };
    }
    const result = body.result || {};
    // result keyed by lowercase address
    const keys = Object.keys(result);
    const raw =
      result[address.toLowerCase()] ||
      result[address] ||
      (keys.length ? result[keys[0]] : null);
    return normalizeSecurity(raw, chainId);
  } catch (e) {
    console.error('[GoPlus]', e.response?.status || e.message);
    return {
      available: false,
      error: e.response?.data?.message || e.message,
      chainId,
      flags: []
    };
  }
}

async function fetchSolanaSecurity(mint) {
  const url = 'https://api.gopluslabs.io/api/v1/solana/token_security';
  const headers = { Accept: 'application/json' };
  if (process.env.GOPLUS_API_KEY) {
    headers.Authorization = 'Bearer ' + process.env.GOPLUS_API_KEY;
  }
  try {
    const res = await axios.get(url, {
      params: { contract_addresses: mint },
      headers,
      timeout: 12000
    });
    const body = res.data || {};
    const result = body.result || {};
    const keys = Object.keys(result);
    const raw = result[mint] || (keys.length ? result[keys[0]] : null);
    if (!raw) {
      return { available: false, error: 'No Solana data', chainId: 'solana', flags: [] };
    }
    // Map Solana fields loosely into same flag shape
    const mapped = {
      is_open_source: raw.metadata_mutable === '0' ? '1' : '0',
      is_mintable: raw.mintable || raw.mint_authority === null ? '0' : '1',
      owner_address: raw.upgrade_authority || raw.mint_authority || '',
      is_honeypot: '0',
      buy_tax: '0',
      sell_tax: '0',
      holder_count: raw.holder_count,
      holders: raw.holders
    };
    return normalizeSecurity(mapped, 'solana');
  } catch (e) {
    console.error('[GoPlus Solana]', e.message);
    return { available: false, error: e.message, chainId: 'solana', flags: [] };
  }
}

module.exports = {
  fetchTokenSecurity,
  resolveChainId,
  normalizeSecurity,
  CHAIN_IDS
};
