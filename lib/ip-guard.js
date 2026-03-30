const ALLOWED_IPS = (process.env.ALLOWED_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);

function checkIp(req, res) {
  if (ALLOWED_IPS.length === 0) return true;

  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = forwarded.split(',')[0].trim() || req.socket?.remoteAddress || '';

  if (ALLOWED_IPS.some(allowed => ip.startsWith(allowed))) {
    return true;
  }

  res.status(403).json({ error: '회사 네트워크에서만 접근 가능합니다.' });
  return false;
}

module.exports = { checkIp };
