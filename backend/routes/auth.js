import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Survey from '../models/Survey.js';
import { localDb } from '../localDb.js';
import { getJwtSecret } from '../config/jwt.js';

const router = express.Router();

async function verifyCaptcha(captchaToken, req) {
  if (!captchaToken) {
    const error = new Error('Please complete the captcha verification.');
    error.status = 400;
    throw error;
  }

  if (!process.env.RECAPTCHA_SECRET_KEY) {
    const error = new Error('Captcha verification is not configured on the server.');
    error.status = 500;
    throw error;
  }

  const params = new URLSearchParams({
    secret: process.env.RECAPTCHA_SECRET_KEY,
    response: captchaToken,
  });

  if (req.ip) {
    params.append('remoteip', req.ip);
  }

  let captchaResponse;
  try {
    captchaResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
  } catch (error) {
    const verificationError = new Error('Captcha verification service is unavailable. Please try again.');
    verificationError.status = 503;
    throw verificationError;
  }

  const captchaResult = await captchaResponse.json();
  if (!captchaResult.success) {
    const error = new Error('Captcha verification failed. Please try again.');
    error.status = 400;
    throw error;
  }
}

async function getUserSurveys(username, isConnected) {
  let draft = null;
  let surveys = [];

  try {
    draft = await localDb.getSurveyDraft(username);
  } catch (error) {
    console.error('Error fetching offline draft:', error);
  }

  try {
    if (isConnected) {
      const all = await Survey.find({ "respondent.username": username });
      surveys = all.map(s => s.toObject());
    } else {
      const all = await localDb.getAllSubmittedSurveys();
      surveys = all.filter(s => s.respondent?.username === username);
    }
  } catch (error) {
    console.error('Error fetching surveys:', error);
  }

  return { draft, surveys };
}

async function issueLoginResponse(res, user, username, isConnected) {
  const token = jwt.sign({ userId: user._id, username }, getJwtSecret(), { expiresIn: '7d' });
  const { draft, surveys } = await getUserSurveys(username, isConnected);
  return res.json({ token, username, draft, surveys });
}

router.post('/register', async (req, res) => {
  try {
    const { username, password, captchaToken } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    await verifyCaptcha(captchaToken, req);

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
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password, captchaToken } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    await verifyCaptcha(captchaToken, req);

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

      return issueLoginResponse(res, user, username, isConnected);
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return issueLoginResponse(res, user, username, isConnected);
  } catch (error) {
    console.error('Login error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Login failed' });
  }
});

router.post('/login-or-register', async (req, res) => {
  try {
    const { username, password, captchaToken } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    await verifyCaptcha(captchaToken, req);

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      let user = await localDb.findUser(username);
      if (!user) {
        await localDb.createUser(username, password);
        user = await localDb.findUser(username);
      }

      const isValid = await user.comparePassword(password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials (offline mode)' });
      }

      return issueLoginResponse(res, user, username, isConnected);
    }

    let user = await User.findOne({ username });
    if (!user) {
      user = new User({ username, password });
      await user.save();
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return issueLoginResponse(res, user, username, isConnected);
  } catch (error) {
    console.error('Login/register error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Login failed' });
  }
});

export default router;

