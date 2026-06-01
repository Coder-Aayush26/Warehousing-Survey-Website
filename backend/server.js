import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import authRoutes from './routes/auth.js';
import surveyRoutes from './routes/survey.js';
import User from './models/User.js';

// Force Node.js to resolve IPv4 first (prevents querySrv ECONNREFUSED in Node 18+ on Windows)
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://warehousing-survey-website.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// Serve frontend static files
// app.use(express.static(path.join(__dirname, '../dist')));

// MongoDB Connection
let mongoConnected = false;
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/survey-db';
console.log('Connecting to MongoDB...');

// Check for unencoded '@' in credentials before connecting
const rawUri = process.env.MONGODB_URI || '';
const uriSchemeMatch = rawUri.match(/^mongodb(?:\+srv)?:\/\//);
if (uriSchemeMatch) {
  const scheme = uriSchemeMatch[0];
  const rest = rawUri.slice(scheme.length);
  // Split by last '@' which separates credentials from host
  const lastAtIndex = rest.lastIndexOf('@');
  if (lastAtIndex !== -1) {
    const credentials = rest.slice(0, lastAtIndex);
    // If the username portion before the first ':' contains an '@'
    const username = credentials.split(':')[0];
    if (username.includes('@')) {
      console.warn('\n⚠️  DIAGNOSTIC WARNING: Your MONGODB_URI username appears to contain an unencoded "@" character (e.g., an email address).');
      console.warn('  MongoDB will fail to parse this because it interprets the "@" as the separator for the host.');
      console.warn('  You must URL-encode the "@" as "%40" in your username.');
      console.warn('  Example:');
      console.warn(`    Change: mongodb+srv://${username}:password@host`);
      console.warn(`    To:     mongodb+srv://${username.replace('@', '%40')}:password@host\n`);
    }
  }
}

async function ensureAdminUser() {
  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!adminUsername || !adminPassword) {
    console.warn('Admin user was not seeded because ADMIN_USERNAME and ADMIN_PASSWORD are not configured.');
    return;
  }

  const existing = await User.findOne({ username: adminUsername });
  if (!existing) {
    const user = new User({ username: adminUsername, password: adminPassword });
    await user.save();
    console.log(`Admin user created (${adminUsername})`);
    return;
  }

  const passwordMatches = await existing.comparePassword(adminPassword);
  if (!passwordMatches) {
    existing.password = adminPassword;
    await existing.save();
    console.log(`Admin user password updated (${adminUsername})`);
    return;
  }

  console.log(`Admin user ready (${adminUsername})`);
}

mongoose.connect(mongoUri)
  .then(async () => {
    mongoConnected = true;
    console.log('✓ MongoDB connected successfully');
    await ensureAdminUser();
  })
  .catch(err => {
    mongoConnected = false;
    console.error('✗ MongoDB connection failed');
    console.error('  Error:', err.message);
    console.error('  URI:', mongoUri.replace(/:[^@]+@/, ':****@'));
    
    console.warn('\n⚠️  WARNING: Running in OFFLINE/FALLBACK mode because MongoDB connection failed.');
    console.warn('  Survey responses and admin users will be saved locally inside: backend/data/');
    console.warn('  To fix and connect to your actual MongoDB Atlas cluster, check:');
    console.warn('  1. IP WHITELISTING: Make sure your current IP address is whitelisted on your Atlas cluster.');
    console.warn('     Go to MongoDB Atlas -> Network Access -> Add IP Address -> Allow Access From Anywhere (0.0.0.0/0) or add current IP.');
    console.warn('  2. ENCODED CREDENTIALS: If your database user username is an email address, verify the "@" is encoded as "%40".');
    console.warn('  3. CREDENTIALS VALIDITY: Ensure the database user username and password are correct in backend/.env.\n');
  });

// Export connection status for use in routes
app.locals.mongoConnected = () => mongoConnected;

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/survey', surveyRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({ 
    error: error.message || 'Internal server error' 
  });
});

// Serve frontend for all other routes (SPA routing)
// // app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../dist/index.html'));
// });

app.listen(PORT, () => {
  console.log(`\n✓ Server running on http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api`);
  console.log(`  Frontend: http://localhost:${PORT}\n`);
});

