const jwt = require('jsonwebtoken');

// Verifies a Bearer token issued by POST /api/admin/login.
module.exports = function adminAuth(req, res, next) {
  const authHeader = req.header('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match || !match[1].trim()) {
    return res.status(401).json({ message: 'Unauthorized. Please sign in.' });
  }

  const token = match[1].trim();

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'Server misconfiguration: JWT_SECRET is not set.' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    if (payload.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden.' });
    }
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' });
  }
};
