/**
 * api/wingo.js — dkwin Wingo 1Min Live Result Proxy
 * Vercel serverless function — CORS fix + dkwin API fetch
 */

// ── dkwin possible base URLs (try in order) ────────────────────
const SOURCES = [
  'https://dkwin.net',
  'https://www.dkwin.net',
  'https://api.dkwin.net',
  'https://dkwin1.com',
];

const ENDPOINT = '/api/webapi/GetNoaverageEmerdList';

// typeId: 1=1min, 2=3min, 3=5min, 4=10min
const TYPE_MAP = { '1min': 1, '3min': 2, '5min': 3, '10min': 4 };

// colour helper
function getColour(num) {
  const n = parseInt(num);
  if (n === 0) return 'violet_red';   // 0 = red + violet
  if (n === 5) return 'violet_green'; // 5 = green + violet
  if ([1,3,7,9].includes(n)) return 'green';
  if ([2,4,6,8].includes(n)) return 'red';
  return 'unknown';
}

function getBigSmall(num) {
  return parseInt(num) >= 5 ? 'Big' : 'Small';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type   = req.query.type   || '1min';
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const typeId = TYPE_MAP[type] || 1;

  const body = JSON.stringify({
    pageSize:  limit,
    pageNo:    1,
    typeId:    typeId,
    language:  0,
    random:    Math.random().toString(36).substring(2),
    signature: Math.random().toString(36).substring(2),
    timestamp: Math.floor(Date.now() / 1000)
  });

  let lastError = '';

  for (const base of SOURCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const r = await fetch(base + ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':        'application/json',
          'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin':        base,
          'Referer':       base + '/',
        },
        body,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!r.ok) { lastError = `HTTP ${r.status} from ${base}`; continue; }

      const json = await r.json();

      // Normalize response — different platforms have slightly different shapes
      let list = json?.data?.list || json?.data?.records || json?.list || [];

      if (!list.length) { lastError = `Empty list from ${base}`; continue; }

      // Normalize each record
      const results = list.map(item => {
        const num = String(item.number ?? item.preNumber ?? item.openCode ?? '?');
        const colour = item.colour || item.color || getColour(num);
        return {
          period:   String(item.issueNumber || item.issue || item.period || ''),
          number:   num,
          colour:   colour,
          bigSmall: item.bigSmall || getBigSmall(num),
          source:   base
        };
      });

      // Current period info (for countdown)
      const now   = Date.now();
      const ms60  = 60 * 1000;
      const epoch = Math.floor(now / ms60) * ms60;
      const nextMs = epoch + ms60;
      const secsLeft = Math.ceil((nextMs - now) / 1000);

      return res.json({
        ok:       true,
        type,
        results,
        secsLeft,
        fetchedAt: new Date().toISOString(),
        source:    base
      });

    } catch(e) {
      lastError = e.message;
    }
  }

  // All sources failed — return error
  return res.status(502).json({
    ok:    false,
    error: 'All sources failed: ' + lastError,
    type,
    results: [],
    secsLeft: 0
  });
};
