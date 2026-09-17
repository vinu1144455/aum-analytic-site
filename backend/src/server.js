require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const requirementsRouter = require('./routes/requirements');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;

const fs = require('fs');

// ---- CORS: only allow the configured origins to call this API ----
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // file:// protocol sends origin: "null" — browsers reject ACAO: null, so we use * in that case
  if (!origin || origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }
  next();
});

app.use(cors({
  origin(origin, callback) {
    // Allow same-origin / non-browser requests, any localhost/127.0.0.1 port, or configured domains
    if (
      !origin ||
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Requirements API routes (rate limiter applied specifically to POST inside the router) ----
app.use('/api/requirements', requirementsRouter);

// ---- Rate limit login attempts to slow down brute-force guessing ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

app.use('/api/admin', loginLimiter, authRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---- 404 for unhandled API endpoints ----
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found.' });
});

// ---- Serve the static frontend if frontend directory exists ----
const FRONTEND_DIR = [
  path.resolve(__dirname, '..', '..', 'frontend'),
  path.resolve(__dirname, '..', 'frontend'),
  path.resolve(__dirname, 'frontend'),
].find((p) => fs.existsSync(p));

if (FRONTEND_DIR) {
  app.use(express.static(FRONTEND_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

// ---- Centralized error handler ----
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Internal server error.' });
});

const server = app.listen(PORT, () => {
  console.log(`AUM ANALYTIC backend listening on http://localhost:${PORT}`);
});

module.exports = { app, server };
