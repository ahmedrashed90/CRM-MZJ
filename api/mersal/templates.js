module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }
  const configuredBase = (process.env.MERSAL_API_ENDPOINT || 'https://w-mersal.com').replace(/\/+$/, '');
  const token = process.env.MERSAL_TOKEN || process.env.MERSAL_API_TOKEN || '';
  if (!token) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: 'MERSAL_TOKEN غير موجود في Environment Variables' }));
  }

  const bases = Array.from(new Set([
    configuredBase,
    'https://w-mersal.com',
    'https://api.w-mersal.com'
  ].filter(Boolean)));

  let lastError = null;
  for (const base of bases) {
    const url = `${base}/api/wpbox/getTemplates?token=${encodeURIComponent(token)}`;
    try {
      const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch (error) { data = { raw: text }; }
      if (!upstream.ok) {
        lastError = data?.message || data?.error || `HTTP ${upstream.status}`;
        continue;
      }
      const templates = Array.isArray(data?.templates) ? data.templates : [];
      return res.end(JSON.stringify({ ok: true, status: data?.status || 'success', count: templates.length, source: base, templates }));
    } catch (error) {
      lastError = error?.message || 'فشل الاتصال بمرسال';
    }
  }

  res.statusCode = 500;
  return res.end(JSON.stringify({ ok: false, error: lastError || 'فشل جلب القوالب من مرسال' }));
};
