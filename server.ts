import express, { Request, Response } from 'express';
import next from 'next';
import path from 'path';
import { INITIAL_STATE } from './src/data/initialData';
import { AppSettings, GoldItem, GoldRates, SystemState } from './src/types';

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: process.cwd() });
const handle = nextApp.getRequestHandler();

const app = express();
const PORT = 3000;

app.use(express.json());

// Server state
let state: SystemState = JSON.parse(JSON.stringify(INITIAL_STATE));

// SSE Clients
const clients: Response[] = [];

function broadcastState(type: string = 'FULL_UPDATE') {
  const payload = JSON.stringify({ type, data: state });
  clients.forEach((client) => {
    client.write(`data: ${payload}\n\n`);
  });
}

// Auto price simulation & live market fetch interval handle
let simulationTimer: NodeJS.Timeout | null = null;

async function fetchLiveGoldPriceFromInvesting() {
  try {
    let xauUsdPrice: number | null = null;
    let usdEgpRate = 48.65; // baseline exchange rate fallback

    // Attempt 1: Fetch sa.investing.com xau-usd page
    try {
      const resp = await fetch('https://sa.investing.com/currencies/xau-usd', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
      });
      if (resp.ok) {
        const html = await resp.text();
        const match =
          html.match(/data-test="instrument-price-last"[^>]*>([\d,\.]+)</) ||
          html.match(/class="[^"]*instrument-price_last[^"]*"[^>]*>([\d,\.]+)</) ||
          html.match(/"last_price":\s*([\d\.]+)/);
        if (match && match[1]) {
          const val = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(val) && val > 500 && val < 10000) {
            xauUsdPrice = val;
          }
        }
      }
    } catch (e) {
      console.warn('Investing.com fetch note:', e);
    }

    // Fallback 1: Yahoo Finance GC=F
    if (!xauUsdPrice) {
      try {
        const yRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (yRes.ok) {
          const yData = await yRes.json();
          const p = yData?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (p && typeof p === 'number') {
            xauUsdPrice = p;
          }
        }
      } catch (e) {
        console.warn('Yahoo GC=F fetch note:', e);
      }
    }

    // Fallback 2: Goldprice API
    if (!xauUsdPrice) {
      try {
        const gpRes = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        if (gpRes.ok) {
          const gpData = await gpRes.json();
          const p = gpData?.items?.[0]?.xauPrice;
          if (p && typeof p === 'number') {
            xauUsdPrice = p;
          }
        }
      } catch (e) {
        console.warn('Goldprice fetch note:', e);
      }
    }

    // Fetch EGP exchange rate
    try {
      const erRes = await fetch('https://open.er-api.com/v6/latest/USD');
      if (erRes.ok) {
        const erData = await erRes.json();
        if (erData?.rates?.EGP) {
          usdEgpRate = erData.rates.EGP;
        }
      }
    } catch (e) {
      console.warn('Exchange rate fetch note:', e);
    }

    if (!xauUsdPrice) {
      xauUsdPrice = 2415.5; // fallback spot gold USD/oz
    }

    // Convert Troy Ounce -> Gram (1 oz = 31.1034768 grams)
    const pricePerGram24USD = xauUsdPrice / 31.1034768;
    const raw24Egp = pricePerGram24USD * usdEgpRate;

    let roundFn = (v: number) => Math.round(v);
    if (state.settings.roundingMode === 'nearest_5') {
      roundFn = (v: number) => Math.round(v / 5) * 5;
    } else if (state.settings.roundingMode === 'exact') {
      roundFn = (v: number) => Math.round(v * 100) / 100;
    }

    const k24 = roundFn(raw24Egp);
    const k21 = roundFn(raw24Egp * (21 / 24));
    const k18 = roundFn(raw24Egp * (18 / 24));

    return { k24, k21, k18, xauUsd: xauUsdPrice, usdRate: usdEgpRate };
  } catch (err) {
    console.error('Failed to calculate live EGP gold price:', err);
    return null;
  }
}

function updateSimulationTimer() {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }

  if (state.settings.autoLiveSimulation) {
    const intervalMs = (state.settings.simulationIntervalSec || 10) * 1000;
    
    // Initial fetch when activated
    fetchLiveGoldPriceFromInvesting().then((result) => {
      if (result) {
        const old24 = state.rates.k24;
        const old21 = state.rates.k21;
        const old18 = state.rates.k18;

        state.rates.trends = {
          k24: result.k24 > old24 ? 'up' : result.k24 < old24 ? 'down' : 'stable',
          k21: result.k21 > old21 ? 'up' : result.k21 < old21 ? 'down' : 'stable',
          k18: result.k18 > old18 ? 'up' : result.k18 < old18 ? 'down' : 'stable',
        };

        state.rates.k24 = result.k24;
        state.rates.k21 = result.k21;
        state.rates.k18 = result.k18;
        state.rates.lastUpdated = new Date().toISOString();
        state.rates.updatedBy = `البورصة العالمية XAU/USD (EGP)`;

        broadcastState('RATES_UPDATE');
      }
    });

    simulationTimer = setInterval(async () => {
      const result = await fetchLiveGoldPriceFromInvesting();
      if (result) {
        const old24 = state.rates.k24;
        const old21 = state.rates.k21;
        const old18 = state.rates.k18;

        state.rates.trends = {
          k24: result.k24 > old24 ? 'up' : result.k24 < old24 ? 'down' : 'stable',
          k21: result.k21 > old21 ? 'up' : result.k21 < old21 ? 'down' : 'stable',
          k18: result.k18 > old18 ? 'up' : result.k18 < old18 ? 'down' : 'stable',
        };

        state.rates.k24 = result.k24;
        state.rates.k21 = result.k21;
        state.rates.k18 = result.k18;
        state.rates.lastUpdated = new Date().toISOString();
        state.rates.updatedBy = `البورصة العالمية XAU/USD (EGP)`;

        broadcastState('RATES_UPDATE');
      }
    }, intervalMs);
  }
}

// REST API Endpoints

// GET /api/state
app.get('/api/state', (req: Request, res: Response) => {
  res.json(state);
});

// SSE endpoint for real-time live updates
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial state upon connection
  res.write(`data: ${JSON.stringify({ type: 'INIT', data: state })}\n\n`);

  clients.push(res);

  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

// POST /api/fetch-live-gold - Fetch XAU/USD live gold price & calculate in EGP
app.post('/api/fetch-live-gold', async (req: Request, res: Response) => {
  const result = await fetchLiveGoldPriceFromInvesting();
  if (result) {
    const old24 = state.rates.k24;
    const old21 = state.rates.k21;
    const old18 = state.rates.k18;

    state.rates.trends = {
      k24: result.k24 > old24 ? 'up' : result.k24 < old24 ? 'down' : 'stable',
      k21: result.k21 > old21 ? 'up' : result.k21 < old21 ? 'down' : 'stable',
      k18: result.k18 > old18 ? 'up' : result.k18 < old18 ? 'down' : 'stable',
    };

    state.rates.k24 = result.k24;
    state.rates.k21 = result.k21;
    state.rates.k18 = result.k18;
    state.rates.lastUpdated = new Date().toISOString();
    state.rates.updatedBy = `البورصة العالمية XAU/USD (${result.xauUsd}$ / أونصة)`;

    broadcastState('RATES_UPDATE');
    res.json({ success: true, rates: state.rates, xauUsd: result.xauUsd, usdRate: result.usdRate });
  } else {
    res.status(500).json({ error: 'Failed to fetch live prices' });
  }
});

// POST /api/rates - Admin update gold rates
app.post('/api/rates', (req: Request, res: Response) => {
  const { k24, k21, k18, updatedBy } = req.body;

  if (typeof k24 === 'number' && typeof k21 === 'number') {
    const old24 = state.rates.k24;
    const old21 = state.rates.k21;

    state.rates.trends.k24 = k24 > old24 ? 'up' : k24 < old24 ? 'down' : 'stable';
    state.rates.trends.k21 = k21 > old21 ? 'up' : k21 < old21 ? 'down' : 'stable';

    state.rates.k24 = k24;
    state.rates.k21 = k21;
    state.rates.k18 = typeof k18 === 'number' ? k18 : Math.round((k24 * (18 / 24)) * 100) / 100;
    state.rates.lastUpdated = new Date().toISOString();
    state.rates.updatedBy = updatedBy || 'Admin';

    broadcastState('RATES_UPDATE');
    res.json({ success: true, rates: state.rates });
  } else {
    res.status(400).json({ error: 'Invalid rate values' });
  }
});

// POST /api/items - Admin save items list (add, edit, delete, reorder)
app.post('/api/items', (req: Request, res: Response) => {
  const { items } = req.body;
  if (Array.isArray(items)) {
    state.items = items;
    broadcastState('ITEMS_UPDATE');
    res.json({ success: true, items: state.items });
  } else {
    res.status(400).json({ error: 'Items must be an array' });
  }
});

// POST /api/settings - Admin save settings
app.post('/api/settings', (req: Request, res: Response) => {
  const newSettings: Partial<AppSettings> = req.body;
  state.settings = { ...state.settings, ...newSettings };

  updateSimulationTimer();
  broadcastState('SETTINGS_UPDATE');
  res.json({ success: true, settings: state.settings });
});

// POST /api/admin/verify-pin - Check pin
app.post('/api/admin/verify-pin', (req: Request, res: Response) => {
  const { pin } = req.body;
  if (pin === state.settings.adminPin) {
    res.json({ success: true, role: 'admin' });
  } else if (state.settings.pricePin && pin === state.settings.pricePin) {
    res.json({ success: true, role: 'price_only' });
  } else if (state.settings.visibilityPin && pin === state.settings.visibilityPin) {
    res.json({ success: true, role: 'visibility_only' });
  } else {
    res.status(401).json({ error: 'Incorrect PIN' });
  }
});

// POST /api/reset-defaults - Restore original initial photo data
app.post('/api/reset-defaults', (req: Request, res: Response) => {
  state = JSON.parse(JSON.stringify(INITIAL_STATE));
  updateSimulationTimer();
  broadcastState('FULL_UPDATE');
  res.json({ success: true, state });
});

async function startServer() {
  await nextApp.prepare();

  // Next.js catch-all page handler for all non-Express-API routes
  app.all('*', (req: Request, res: Response) => {
    return handle(req, res);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORO Gold System server running on Next.js at http://0.0.0.0:${PORT}`);
    updateSimulationTimer();
  });
}

startServer();
