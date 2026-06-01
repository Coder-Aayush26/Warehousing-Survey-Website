import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt.js';

const DEFAULT_ADMIN_USERNAME = 'admin@gmail.com';

export const isAdminUsername = (username) => {
  const adminUsername = process.env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;
  return String(username || '').trim().toLowerCase() === adminUsername.toLowerCase();
};

export const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireAdmin = (req, res, next) => {
  const adminUsername = process.env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;

  if (!adminUsername) {
    return res.status(500).json({ error: 'Admin username is not configured' });
  }

  if (!isAdminUsername(req.user?.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};
