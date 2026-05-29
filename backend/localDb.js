import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'local_users.json');
const SURVEYS_FILE = path.join(DATA_DIR, 'local_surveys.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, defaultData = []) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return defaultData;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing to ${file}:`, err);
  }
}

async function seedLocalAdmin() {
  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!adminUsername || !adminPassword) {
    console.warn('[Offline Mode] Admin user was not seeded because ADMIN_USERNAME and ADMIN_PASSWORD are not configured.');
    return;
  }

  const users = readJSON(USERS_FILE);
  const adminUser = users.find(u => u.username === adminUsername);
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    users.push({
      _id: 'local-admin-id',
      username: adminUsername,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });
    writeJSON(USERS_FILE, users);
    console.log(`[Offline Mode] Seeded local admin user (username: ${adminUsername})`);
    return;
  }

  const passwordMatches = await bcrypt.compare(adminPassword, adminUser.password);
  if (!passwordMatches) {
    adminUser.password = await bcrypt.hash(adminPassword, 10);
    writeJSON(USERS_FILE, users);
    console.log(`[Offline Mode] Updated local admin password (username: ${adminUsername})`);
  }
}

seedLocalAdmin().catch(err => console.error('Error seeding local admin:', err));

export const localDb = {
  async findUser(username) {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return null;
    return {
      ...user,
      comparePassword: async (plainPassword) => {
        return bcrypt.compare(plainPassword, user.password);
      }
    };
  },

  async createUser(username, plainPassword) {
    const users = readJSON(USERS_FILE);
    if (users.some(u => u.username === username)) {
      throw new Error('User already exists');
    }
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const newUser = {
      _id: 'user_' + Math.random().toString(36).substr(2, 9),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    return newUser;
  },

  async saveSurveyDraft(username, surveyData) {
    const surveys = readJSON(SURVEYS_FILE);
    let surveyIndex = surveys.findIndex(s => s.respondent?.username === username && s.status === 'draft');
    const now = new Date().toISOString();

    if (surveyIndex !== -1) {
      surveys[surveyIndex] = {
        ...surveys[surveyIndex],
        respondent: { ...surveyData.respondent, username },
        answers: surveyData.answers,
        confirmed: surveyData.confirmed,
        confirmedSnapshot: surveyData.confirmedSnapshot,
        skipped: surveyData.skipped,
        progress: surveyData.progress,
        updatedAt: now
      };
    } else {
      const newSurvey = {
        _id: 'survey_' + Math.random().toString(36).substr(2, 9),
        respondent: { ...surveyData.respondent, username },
        answers: surveyData.answers,
        confirmed: surveyData.confirmed,
        confirmedSnapshot: surveyData.confirmedSnapshot,
        skipped: surveyData.skipped,
        progress: surveyData.progress,
        status: 'draft',
        createdAt: now,
        updatedAt: now
      };
      surveys.push(newSurvey);
      surveyIndex = surveys.length - 1;
    }

    writeJSON(SURVEYS_FILE, surveys);
    return surveys[surveyIndex];
  },

  async getSurveyDraft(username) {
    const surveys = readJSON(SURVEYS_FILE);
    const survey = surveys.find(s => s.respondent?.username === username && s.status === 'draft');
    return survey || null;
  },

  async submitSurvey(surveyId) {
    const surveys = readJSON(SURVEYS_FILE);
    const surveyIndex = surveys.findIndex(s => s._id === surveyId);
    if (surveyIndex === -1) {
      throw new Error('Survey draft not found');
    }

    surveys[surveyIndex] = {
      ...surveys[surveyIndex],
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    writeJSON(SURVEYS_FILE, surveys);
    return surveys[surveyIndex];
  },

  async getAllSubmittedSurveys() {
    const surveys = readJSON(SURVEYS_FILE);
    return surveys.filter(s => s.status === 'submitted');
  }
};
