import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Survey from '../models/Survey.js';
import { localDb } from '../localDb.js';
import { getJwtSecret } from '../config/jwt.js';
import { isAdminUsername, verifyToken } from '../middleware/auth.js';

const router = express.Router();

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// Validates the bearer token and returns the logged-in user's info.
// The frontend calls this once on page load to silently restore the session.
router.get('/me', verifyToken, (req, res) => {
  const isAdmin = isAdminUsername(req.user.username);
  res.json({ username: req.user.username, isAdmin });
});


router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (isAdminUsername(username)) {
      return res.status(403).json({ error: 'Admin account cannot be registered here' });
    }

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const existingUser = await localDb.findUser(username);
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists (offline mode)' });
      }
      await localDb.createUser(username, password);
      return res.json({ message: 'User created successfully (offline mode)' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const user = new User({ username, password });
    await user.save();
    res.json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const user = await localDb.findUser(username);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials (offline mode)' });
      }

      const isValid = await user.comparePassword(password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials (offline mode)' });
      }

      const token = jwt.sign({ userId: user._id, username }, getJwtSecret(), { expiresIn: '7d' });
      // Retrieve offline draft (if any)
      let draft = null;
      try {
        draft = await localDb.getSurveyDraft(username);
      } catch (e) {
        console.error('Error fetching offline draft:', e);
      }
      // Retrieve all offline surveys for the user (draft + submitted)
      let surveys = [];
      try {
        const all = await localDb.getAllSubmittedSurveys();
        surveys = all.filter(s => s.respondent?.username === username);
      } catch (e) {
        console.error('Error fetching offline surveys:', e);
      }
      return res.json({ token, username, isAdmin: isAdminUsername(username), draft, surveys });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, username }, getJwtSecret(), { expiresIn: '7d' });
    // Retrieve user's draft (if any)
    let draft = null;
    try {
      draft = await localDb.getSurveyDraft(username);
    } catch (e) {
      console.error('Error fetching offline draft:', e);
    }
    // Retrieve all surveys for the user (draft + submitted)
    let surveys = [];
    try {
      const all = await Survey.find({ "respondent.username": username });
      surveys = all.map(s => s.toObject());
    } catch (e) {
      console.error('Error fetching surveys:', e);
    }
    return res.json({ token, username, isAdmin: isAdminUsername(username), draft, surveys });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

export default router;

