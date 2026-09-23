/**
 * GoPlus security routes only (payments removed for now).
 *
 * In production server.js:
 *   try { require('./routes-extras')(app); } catch (e) { console.warn('[extras]', e.message); }
 */
const goplus = require('./services/goplus');

function mountExtras(app) {
  if (!app) {
    console.warn('[extras] no app');
    return;
  }

  app.get('/api/security/:chain/:address', async (req, res) => {
    try {
      const chain = req.params.chain;
      const address = req.params.address;
      if (!address || address.length < 4) {
        return res.status(400).json({ success: false, error: 'Invalid address' });
      }
      const data = await goplus.fetchTokenSecurity(chain, address);
      res.json({ success: true, security: data });
    } catch (e) {
      console.error('[security]', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/security/check', async (req, res) => {
    try {
      const { chain, address } = req.body || {};
      if (!address) {
        return res.status(400).json({ success: false, error: 'address required' });
      }
      const data = await goplus.fetchTokenSecurity(chain || 'ethereum', address);
      res.json({ success: true, security: data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  console.log('[extras] GoPlus security routes mounted');
}

module.exports = mountExtras;
