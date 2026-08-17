const axios = require("axios");

async function getTokenData(token){

  const response =
  await axios.get(
    `https://api.dexscreener.com/latest/dex/tokens/${token}`
  );

  const pair =
  response.data?.pairs?.[0];

  if(!pair){

    throw new Error(
      "Token not found"
    );

  }

  return {

    name:
    pair.baseToken?.name
    || "Unknown",

    symbol:
    pair.baseToken?.symbol
    || "UNKNOWN",

    price:
    pair.priceUsd || 0,

    liquidity:
    pair.liquidity?.usd || 0,

    volume:
    pair.volume?.h24 || 0,

    drop24h:
    pair.priceChange?.h24 || 0

  };

}

module.exports = {
  getTokenData
};