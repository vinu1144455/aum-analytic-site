const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Rate limit public submission endpoint to prevent spam/abuse
const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many submissions from this device. Please try again later.' },
});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
  'application/x-zip-compressed',
  'application/zip',
  'text/plain',
  'text/rtf',
  'application/rtf',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.rtf']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname).slice(0, 10).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeAllowed = ALLOWED_MIME_TYPES.has(file.mimetype);
    const extAllowed = ALLOWED_EXTENSIONS.has(ext);

    if (!extAllowed || !mimeAllowed) {
      return cb(new Error('Unsupported file type. Please upload a PDF, Word document (.doc, .docx), or .txt file.'));
    }
    cb(null, true);
  },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBody(body) {
  const errors = [];
  if (!body.fullName || !body.fullName.trim()) errors.push('Full name is required.');
  if (!body.companyName || !body.companyName.trim()) errors.push('Company name is required.');
  if (!body.email || !EMAIL_RE.test(body.email.trim())) errors.push('A valid business email is required.');
  if (!body.phone || !body.phone.trim()) errors.push('Phone number is required.');

  if (body.numberOfPositions !== undefined && body.numberOfPositions !== null) {
    const rawPos = String(body.numberOfPositions).trim();
    if (rawPos !== '') {
      const num = Number(rawPos);
      if (!Number.isInteger(num) || num < 1 || isNaN(num)) {
        errors.push('Number of positions must be a positive integer.');
      }
    }
  }

  return errors;
}

// POST /api/requirements — public: submit a hiring requirement (used by the contact form)
router.post('/', submissionLimiter, (req, res) => {
  upload.single('jobDescription')(req, res, (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the maximum allowed size of 5 MB.'
        : (uploadErr.message || 'File upload failed.');
      return res.status(400).json({ message: msg });
    }

    const errors = validateBody(req.body);
    if (errors.length) {
      // Clean up an uploaded file if validation fails after upload.
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: errors.join(' ') });
    }

    const {
      fullName, companyName, email, phone,
      industry, serviceRequired, numberOfPositions, jobDetails,
    } = req.body;

    try {
      const stmt = db.prepare(`
        INSERT INTO requirements
          (full_name, company_name, email, phone, industry, service_required,
           number_of_positions, job_details, file_path, file_original_name)
        VALUES (@fullName, @companyName, @email, @phone, @industry, @serviceRequired,
                @numberOfPositions, @jobDetails, @filePath, @fileOriginalName)
      `);

      const info = stmt.run({
        fullName: fullName.trim(),
        companyName: companyName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        industry: industry || null,
        serviceRequired: serviceRequired || null,
        numberOfPositions: numberOfPositions && !isNaN(Number(numberOfPositions)) ? Number(numberOfPositions) : null,
        jobDetails: jobDetails || null,
        filePath: req.file ? path.basename(req.file.path) : null,
        fileOriginalName: req.file ? path.basename(req.file.originalname) : null,
      });

      return res.status(201).json({ message: 'Requirement received.', id: info.lastInsertRowid });
    } catch (dbErr) {
      if (req.file) fs.unlink(req.file.path, () => {});
      console.error('Database error on requirement submission:', dbErr);
      return res.status(500).json({ message: 'Could not save submission. Please try again later.' });
    }
  });
});

// GET /api/requirements — admin only: list submissions (requires Authorization: Bearer <token>)
router.get('/', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM requirements ORDER BY created_at DESC').all();
  res.json({ count: rows.length, requirements: rows });
});

// GET /api/requirements/:id/file — admin only: download the uploaded job description for one submission
router.get('/:id/file', adminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'Invalid submission ID.' });
  }

  const row = db.prepare('SELECT file_path, file_original_name FROM requirements WHERE id = ?').get(id);

  if (!row || !row.file_path) {
    return res.status(404).json({ message: 'No file for this submission.' });
  }

  const safeFilename = path.basename(row.file_path);
  const absolutePath = path.resolve(UPLOAD_DIR, safeFilename);

  if (!absolutePath.startsWith(UPLOAD_DIR) || !fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: 'File no longer exists on the server.' });
  }

  const downloadName = path.basename(row.file_original_name || 'job-description');
  res.download(absolutePath, downloadName);
});

// DELETE /api/requirements/:id — admin only: delete a submission and its associated file
router.delete('/:id', adminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'Invalid submission ID.' });
  }

  const row = db.prepare('SELECT file_path FROM requirements WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ message: 'Submission not found.' });
  }

  if (row.file_path) {
    const safeFilename = path.basename(row.file_path);
    const absolutePath = path.resolve(UPLOAD_DIR, safeFilename);
    if (fs.existsSync(absolutePath)) {
      fs.unlink(absolutePath, () => {});
    }
  }

  db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
  res.json({ message: 'Submission deleted successfully.' });
});

module.exports = router;
