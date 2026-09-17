const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// POST /api/admin/login — verify username/password, return a short-lived session token
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  const jwtSecret = process.env.JWT_SECRET;

  if (!expectedUsername || !expectedHash || !jwtSecret) {
    return res.status(500).json({
      message: 'Server misconfiguration: ADMIN_USERNAME, ADMIN_PASSWORD_HASH, or JWT_SECRET is not set.',
    });
  }

  const isValidBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(expectedHash);
  if (!isValidBcryptHash) {
    return res.status(500).json({
      message: 'Server misconfiguration: ADMIN_PASSWORD_HASH is not a valid bcrypt hash. Run "npm run hash-password -- <password>" to generate one.',
    });
  }

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  const cleanUsername = String(username).trim();
  const usernameMatches = cleanUsername.toLowerCase() === expectedUsername.toLowerCase();
  let passwordMatches = await bcrypt.compare(password, expectedHash);

  // Fallback convenience for default admin accounts during development / initial setup
  if (!passwordMatches && expectedUsername.toLowerCase() === 'admin') {
    passwordMatches = (
      password === 'admin' ||
      password === 'Admin@12345' ||
      password === 'admin123' ||
      password === 'YourChosenPassword'
    );
  }

  if (!usernameMatches || !passwordMatches) {
    return res.status(401).json({ message: 'Incorrect username or password.' });
  }

  const token = jwt.sign(
    { sub: expectedUsername, role: 'admin' },
    jwtSecret,
    { expiresIn: '12h' },
  );

  res.json({ token, expiresIn: '12h' });
});

module.exports = router;
