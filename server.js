// ─────────────────────────────────────────────────────────────
//  APEX MARKETS — Backend Proxy Server
//  Deploy on Render.com free tier
//  All API keys stored as environment variables — never hardcoded
// ─────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── IN-MEMORY CACHE (60 second TTL) ──────────────────────────
const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > 60000) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ── SAFE FETCH HELPER ─────────────────────────────────────────
async function safeFetch(url, opts) {
  opts = opts || {};
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(function() { controller.abort(); }, 10000);
    const res        = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('[APEX] safeFetch error:', url.slice(0, 120), e.message);
    return null;
  }
}

// ── HEALTH CHECK / PING ───────────────────────────────────────
app.get('/ping', function(req, res) {
  res.json({ status: 'ok', ts: Date.now() });
});

// ── /api/quote?symbol=AAPL ────────────────────────────────────
// Twelve Data real-time quote
app.get('/api/quote', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json({ error: 'symbol required' });

  var ck = 'quote:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.TD_KEY;
  if (!key) return res.json({ error: 'TD_KEY not configured' });

  var tdSymMap = {
    'BTC-USD':'BTC/USD','ETH-USD':'ETH/USD','SOL-USD':'SOL/USD',
    'BNB-USD':'BNB/USD','XRP-USD':'XRP/USD','DOGE-USD':'DOGE/USD',
    'ADA-USD':'ADA/USD','AVAX-USD':'AVAX/USD','LINK-USD':'LINK/USD',
    'DOT-USD':'DOT/USD','LTC-USD':'LTC/USD','UNI-USD':'UNI/USD',
    'GC=F':'XAU/USD','SI=F':'XAG/USD','CL=F':'WTI/USD','BZ=F':'BRENT/USD',
    '^VIX':'VIX','^GSPC':'SPY','^NDX':'QQQ','^DJI':'DIA',
    'BINANCE:BTCUSDT':'BTC/USD','BINANCE:ETHUSDT':'ETH/USD','BINANCE:SOLUSDT':'SOL/USD',
    'BINANCE:BNBUSDT':'BNB/USD','BINANCE:XRPUSDT':'XRP/USD','BINANCE:DOGEUSDT':'DOGE/USD',
  };
  var tdSym = tdSymMap[symbol] || symbol.replace(/^\^/,'').replace(/=F$/,'').replace(/-USD$/,'/USD');

  var url = 'https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(tdSym) + '&apikey=' + key;
  var d   = await safeFetch(url);

  if (!d || d.status === 'error') {
    return res.json({ symbol: symbol, price: null, change: 0, changePercent: 0, high: null, low: null, volume: 0, previousClose: null });
  }

  var w52 = d['52_week'] || {};
  var result = {
    symbol:           d.symbol || symbol,
    price:            parseFloat(d.close)          || null,
    change:           parseFloat(d.change)         || 0,
    changePercent:    parseFloat(d.percent_change) || 0,
    high:             parseFloat(d.high)           || null,
    low:              parseFloat(d.low)            || null,
    volume:           parseInt(d.volume)           || 0,
    previousClose:    parseFloat(d.previous_close) || null,
    open:             parseFloat(d.open)           || null,
    fiftyTwoWeekHigh: parseFloat(w52.high)         || null,
    fiftyTwoWeekLow:  parseFloat(w52.low)          || null,
  };

  cacheSet(ck, result);
  res.json(result);
});

// ── /api/candles?symbol=AAPL&range=1mo ───────────────────────
// Twelve Data historical OHLCV
app.get('/api/candles', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  var range  = req.query.range || '1mo';
  if (!symbol) return res.json({ timestamps: [], closes: [], opens: [], highs: [], lows: [], volumes: [] });

  var ck = 'candles:' + symbol + ':' + range;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.TD_KEY;
  if (!key) return res.json({ timestamps: [], closes: [], opens: [], highs: [], lows: [], volumes: [] });

  var rangeMap = {
    '1d':  { interval: '5min',   outputsize: 78  },
    '5d':  { interval: '15min',  outputsize: 130 },
    '1mo': { interval: '1day',   outputsize: 30  },
    '3mo': { interval: '1day',   outputsize: 90  },
    '6mo': { interval: '1day',   outputsize: 180 },
    '1y':  { interval: '1week',  outputsize: 52  },
    '5y':  { interval: '1month', outputsize: 60  },
  };
  var rm     = rangeMap[range] || rangeMap['1mo'];
  var interval   = rm.interval;
  var outputsize = rm.outputsize;

  var tdSymMap = {
    'BTC-USD':'BTC/USD','ETH-USD':'ETH/USD','SOL-USD':'SOL/USD',
    'BNB-USD':'BNB/USD','XRP-USD':'XRP/USD','DOGE-USD':'DOGE/USD',
    'ADA-USD':'ADA/USD','AVAX-USD':'AVAX/USD','LINK-USD':'LINK/USD',
    'DOT-USD':'DOT/USD','LTC-USD':'LTC/USD','UNI-USD':'UNI/USD',
    'GC=F':'XAU/USD','SI=F':'XAG/USD','CL=F':'WTI/USD','BZ=F':'BRENT/USD',
    '^VIX':'VIX','^GSPC':'SPY','^NDX':'QQQ','^DJI':'DIA',
    'BINANCE:BTCUSDT':'BTC/USD','BINANCE:ETHUSDT':'ETH/USD','BINANCE:SOLUSDT':'SOL/USD',
    'BINANCE:BNBUSDT':'BNB/USD','BINANCE:XRPUSDT':'XRP/USD','BINANCE:DOGEUSDT':'DOGE/USD',
  };
  var tdSym = tdSymMap[symbol] || symbol.replace(/^\^/,'').replace(/=F$/,'').replace(/-USD$/,'/USD').replace(/^BINANCE:/,'').replace(/USDT$/,'/USD');

  var url = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(tdSym) +
            '&interval=' + interval + '&outputsize=' + outputsize + '&apikey=' + key;
  var d = await safeFetch(url);

  if (!d || d.status === 'error' || !d.values || !d.values.length) {
    return res.json({ timestamps: [], closes: [], opens: [], highs: [], lows: [], volumes: [] });
  }

  var values = d.values.slice().reverse();
  var result = {
    timestamps: values.map(function(v) { return Math.floor(new Date(v.datetime).getTime() / 1000); }),
    closes:     values.map(function(v) { return parseFloat(v.close); }),
    opens:      values.map(function(v) { return parseFloat(v.open); }),
    highs:      values.map(function(v) { return parseFloat(v.high); }),
    lows:       values.map(function(v) { return parseFloat(v.low); }),
    volumes:    values.map(function(v) { return parseInt(v.volume || 0); }),
  };

  cacheSet(ck, result);
  res.json(result);
});

// ── /api/crypto?symbol=bitcoin ────────────────────────────────
// CoinGecko — no API key required
app.get('/api/crypto', async function(req, res) {
  var symbol = (req.query.symbol || 'bitcoin').toLowerCase();
  var ck     = 'crypto:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + symbol +
            '&order=market_cap_desc&per_page=1&page=1&sparkline=true';
  var d = await safeFetch(url);

  if (!d) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/crypto/list ──────────────────────────────────────────
// Top 20 cryptocurrencies from CoinGecko
app.get('/api/crypto/list', async function(req, res) {
  var ck     = 'crypto:list';
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true';
  var d   = await safeFetch(url);

  if (!d) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/news?category=general ────────────────────────────────
// Finnhub market news
app.get('/api/news', async function(req, res) {
  var category = req.query.category || 'general';
  var ck       = 'news:' + category;
  var cached   = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json([]);

  var url = 'https://finnhub.io/api/v1/news?category=' + encodeURIComponent(category) + '&token=' + key;
  var d   = await safeFetch(url);

  if (!d || !Array.isArray(d)) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/company-news?symbol=AAPL ────────────────────────────
// Finnhub company news — last 7 days
app.get('/api/company-news', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json([]);

  var ck     = 'company-news:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json([]);

  var to   = new Date().toISOString().slice(0, 10);
  var from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  var url  = 'https://finnhub.io/api/v1/company-news?symbol=' + symbol + '&from=' + from + '&to=' + to + '&token=' + key;
  var d    = await safeFetch(url);

  if (!d || !Array.isArray(d)) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/profile?symbol=AAPL ─────────────────────────────────
// Finnhub company profile
app.get('/api/profile', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json({});

  var ck     = 'profile:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json({});

  var url = 'https://finnhub.io/api/v1/stock/profile2?symbol=' + symbol + '&token=' + key;
  var d   = await safeFetch(url);

  if (!d) return res.json({});
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/financials?symbol=AAPL ──────────────────────────────
// Finnhub financial metrics
app.get('/api/financials', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json({});

  var ck     = 'financials:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json({});

  var url = 'https://finnhub.io/api/v1/stock/metric?symbol=' + symbol + '&metric=all&token=' + key;
  var d   = await safeFetch(url);

  if (!d) return res.json({});
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/recommendations?symbol=AAPL ─────────────────────────
// Finnhub analyst recommendations
app.get('/api/recommendations', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json([]);

  var ck     = 'recs:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json([]);

  var url = 'https://finnhub.io/api/v1/stock/recommendation?symbol=' + symbol + '&token=' + key;
  var d   = await safeFetch(url);

  if (!d || !Array.isArray(d)) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/earnings?symbol=AAPL ────────────────────────────────
// Finnhub earnings history (last 8 quarters)
app.get('/api/earnings', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json([]);

  var ck     = 'earnings:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json([]);

  var url = 'https://finnhub.io/api/v1/stock/earnings?symbol=' + symbol + '&limit=8&token=' + key;
  var d   = await safeFetch(url);

  if (!d || !Array.isArray(d)) return res.json([]);
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/earnings-calendar ────────────────────────────────────
// Finnhub upcoming earnings — next 7 days
app.get('/api/earnings-calendar', async function(req, res) {
  var ck     = 'earnings-calendar';
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json({ earningsCalendar: [] });

  var today = new Date().toISOString().slice(0, 10);
  var fwd   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  var url   = 'https://finnhub.io/api/v1/calendar/earnings?from=' + today + '&to=' + fwd + '&token=' + key;
  var d     = await safeFetch(url);

  if (!d) return res.json({ earningsCalendar: [] });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/insider?symbol=AAPL ─────────────────────────────────
// Finnhub insider transactions
app.get('/api/insider', async function(req, res) {
  var symbol = ((req.query.symbol || '')).toUpperCase();
  if (!symbol) return res.json({ data: [] });

  var ck     = 'insider:' + symbol;
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json({ data: [] });

  var url = 'https://finnhub.io/api/v1/stock/insider-transactions?symbol=' + symbol + '&token=' + key;
  var d   = await safeFetch(url);

  if (!d) return res.json({ data: [] });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/macro/fed-rate ──────────────────────────────────────
// FRED Federal Funds Rate
app.get('/api/macro/fed-rate', async function(req, res) {
  var ck     = 'macro:fed-rate';
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FRED_KEY;
  if (!key) return res.json({ observations: [] });

  var url = 'https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=' + key +
            '&file_type=json&sort_order=desc&limit=24';
  var d = await safeFetch(url);

  if (!d) return res.json({ observations: [] });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/macro/cpi ───────────────────────────────────────────
// FRED CPI Inflation
app.get('/api/macro/cpi', async function(req, res) {
  var ck     = 'macro:cpi';
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FRED_KEY;
  if (!key) return res.json({ observations: [] });

  var url = 'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=' + key +
            '&file_type=json&sort_order=desc&limit=24';
  var d = await safeFetch(url);

  if (!d) return res.json({ observations: [] });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/macro/treasury?maturity=10year ──────────────────────
// FRED Treasury Yields
app.get('/api/macro/treasury', async function(req, res) {
  var maturity = req.query.maturity || '10year';
  var ck       = 'macro:treasury:' + maturity;
  var cached   = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FRED_KEY;
  if (!key) return res.json({ observations: [] });

  var seriesMap = { '2year': 'DGS2', '5year': 'DGS5', '10year': 'DGS10', '30year': 'DGS30' };
  var series    = seriesMap[maturity] || 'DGS10';
  var url       = 'https://api.stlouisfed.org/fred/series/observations?series_id=' + series +
                  '&api_key=' + key + '&file_type=json&sort_order=desc&limit=24';
  var d         = await safeFetch(url);

  if (!d) return res.json({ observations: [] });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/search?q=Apple ──────────────────────────────────────
// Twelve Data symbol search
app.get('/api/search', async function(req, res) {
  var q  = req.query.q || '';
  if (!q) return res.json([]);

  var ck     = 'search:' + q.toLowerCase();
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.TD_KEY;
  if (!key) return res.json([]);

  var url = 'https://api.twelvedata.com/symbol_search?symbol=' + encodeURIComponent(q) + '&apikey=' + key;
  var d   = await safeFetch(url);

  if (!d || !d.data) return res.json([]);

  var results = d.data.map(function(item) {
    return {
      symbol:      item.symbol,
      description: item.instrument_name,
      type:        item.instrument_type,
    };
  });

  cacheSet(ck, results);
  res.json(results);
});

// ── /api/sector ──────────────────────────────────────────────
// Alpha Vantage sector performance
app.get('/api/sector', async function(req, res) {
  var ck     = 'sector';
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.AV_KEY;
  if (!key) return res.json({});

  var url = 'https://www.alphavantage.co/query?function=SECTOR&apikey=' + key;
  var d   = await safeFetch(url);

  if (!d || d.Note || d.Information) return res.json({});
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/av — Generic Alpha Vantage proxy ────────────────────
// Covers CPI, FEDERAL_FUNDS_RATE, TREASURY_YIELD, SECTOR, etc.
app.get('/api/av', async function(req, res) {
  var params = req.query;
  var ck     = 'av:' + JSON.stringify(params);
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.AV_KEY;
  if (!key) return res.json({ error: 'AV_KEY not configured' });

  var combined = Object.assign({}, params, { apikey: key });
  var qs  = Object.entries(combined).map(function(e) { return e[0] + '=' + encodeURIComponent(e[1]); }).join('&');
  var url = 'https://www.alphavantage.co/query?' + qs;
  var d   = await safeFetch(url);

  if (!d || d.Note || d.Information) return res.json({ rateLimited: true });
  cacheSet(ck, d);
  res.json(d);
});

// ── /api/finnhub — Generic Finnhub proxy ─────────────────────
// Covers any Finnhub endpoint not already individually proxied
app.get('/api/finnhub', async function(req, res) {
  var q      = req.query;
  var fhPath = q.path;
  if (!fhPath) return res.json({ error: 'path required' });

  var params = {};
  Object.keys(q).forEach(function(k) { if (k !== 'path') params[k] = q[k]; });

  var ck     = 'fh:' + fhPath + ':' + JSON.stringify(params);
  var cached = cacheGet(ck);
  if (cached) return res.json(cached);

  var key = process.env.FH_KEY;
  if (!key) return res.json({ error: 'FH_KEY not configured' });

  var url = new URL('https://finnhub.io/api/v1/' + fhPath);
  url.searchParams.set('token', key);
  Object.entries(params).forEach(function(e) { url.searchParams.set(e[0], String(e[1])); });

  var d = await safeFetch(url.toString());

  if (!d)       return res.json(null);
  if (d.error)  return res.json({ error: d.error });
  cacheSet(ck, d);
  res.json(d);
});

// ── SELF-PING every 14 minutes — keeps Render free tier awake ─
setInterval(function() {
  fetch('http://localhost:' + PORT + '/ping').catch(function() {});
}, 14 * 60 * 1000);

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, function() {
  console.log('[APEX] Backend running on port ' + PORT);
});
