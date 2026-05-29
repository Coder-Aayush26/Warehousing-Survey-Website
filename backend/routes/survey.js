import express from 'express';
import Survey from '../models/Survey.js';
import { verifyToken } from '../middleware/auth.js';
import { localDb } from '../localDb.js';

const router = Router();

function Router() {
  return express.Router();
}

function canonicalAnswer(value) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].map(String).sort());
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
      sorted[key] = value[key];
    });
    return JSON.stringify(sorted);
  }

  return JSON.stringify(value);
}

function getRoleSuggestionsFromSurveys(surveys, questionNums) {
  const suggestions = {};

  questionNums.forEach(qnum => {
    const counts = new Map();

    surveys.forEach(survey => {
      const answers = survey.answers || {};
      const confirmed = survey.confirmed || {};
      const skipped = survey.skipped || {};
      const answer = answers[qnum] ?? answers[String(qnum)];
      const isConfirmed = confirmed[qnum] || confirmed[String(qnum)];
      const isSkipped = skipped[qnum] || skipped[String(qnum)];

      if (isSkipped || !isConfirmed || answer == null || answer === '') return;

      const key = canonicalAnswer(answer);
      const current = counts.get(key) || { count: 0, answer };
      current.count += 1;
      counts.set(key, current);
    });

    const total = Array.from(counts.values()).reduce((sum, item) => sum + item.count, 0);
    if (!total) return;

    const top = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
    if (total === 1 || top.count > total / 2) {
      suggestions[qnum] = top.answer;
    }
  });

  return suggestions;
}

// Save/update survey draft
router.post('/save', verifyToken, async (req, res) => {
  try {
    const { respondent, answers, confirmed, confirmedSnapshot, skipped, progress } = req.body;

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const survey = await localDb.saveSurveyDraft(req.user.username, {
        respondent,
        answers,
        confirmed,
        confirmedSnapshot,
        skipped,
        progress
      });
      return res.json({ message: 'Survey saved (offline mode)', surveyId: survey._id });
    }

    let survey = await Survey.findOne({
      'respondent.username': req.user.username,
      status: 'draft'
    });

    if (survey) {
      survey.respondent = { ...respondent, username: req.user.username };
      survey.answers = answers;
      survey.confirmed = confirmed;
      survey.confirmedSnapshot = confirmedSnapshot;
      survey.skipped = skipped;
      survey.progress = progress;
      survey.updatedAt = new Date();
    } else {
      survey = new Survey({
        respondent: { ...respondent, username: req.user.username },
        answers,
        confirmed,
        confirmedSnapshot,
        skipped,
        progress
      });
    }

    await survey.save();
    res.json({ message: 'Survey saved', surveyId: survey._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get draft survey
router.get('/draft', verifyToken, async (req, res) => {
  try {
    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const survey = await localDb.getSurveyDraft(req.user.username);
      return res.json(survey || {});
    }

    const survey = await Survey.findOne({
      'respondent.username': req.user.username,
      status: 'draft'
    });
    res.json(survey || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit survey (mark as completed)
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { surveyId } = req.body;

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const survey = await localDb.submitSurvey(surveyId);
      return res.json({ message: 'Survey submitted successfully (offline mode)', survey });
    }

    const survey = await Survey.findByIdAndUpdate(
      surveyId,
      { status: 'submitted', submittedAt: new Date() },
      { new: true }
    );
    res.json({ message: 'Survey submitted successfully', survey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get submitted surveys (for admin/analytics)
router.get('/all', verifyToken, async (req, res) => {
  try {
    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      const surveys = await localDb.getAllSubmittedSurveys();
      return res.json(surveys);
    }

    const surveys = await Survey.find({ status: 'submitted' });
    res.json(surveys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Suggest answers based on majority responses from submitted surveys with the same role.
router.get('/role-suggestions', verifyToken, async (req, res) => {
  try {
    const roleCode = String(req.query.roleCode || '').trim();
    const role = String(req.query.role || '').trim();
    const questionNums = String(req.query.questions || '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(Number.isFinite);

    if (!questionNums.length || (!roleCode && !role)) {
      return res.json({ suggestions: {} });
    }

    const matchesRole = survey => {
      const respondent = survey.respondent || {};
      if (roleCode && respondent.roleCode === roleCode) return true;
      if (role && respondent.role === role) return true;
      return false;
    };

    const isConnected = req.app.locals.mongoConnected();
    let surveys;

    if (!isConnected) {
      surveys = (await localDb.getAllSubmittedSurveys()).filter(matchesRole);
    } else {
      const roleFilter = roleCode
        ? { 'respondent.roleCode': roleCode }
        : { 'respondent.role': role };
      surveys = await Survey.find({ status: 'submitted', ...roleFilter }).lean();
    }

    res.json({ suggestions: getRoleSuggestionsFromSurveys(surveys, questionNums) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save referral contacts
router.post('/referral', verifyToken, async (req, res) => {
  try {
    const { referrals } = req.body;

    const isConnected = req.app.locals.mongoConnected();
    if (!isConnected) {
      return res.json({ message: 'Referral saved (offline mode)' });
    }

    const survey = await Survey.findOne({
      'respondent.username': req.user.username,
      status: 'draft'
    });

    if (survey) {
      if (!survey.referrals) survey.referrals = [];
      survey.referrals.push(...referrals);
      await survey.save();
      res.json({ message: 'Referrals saved successfully' });
    } else {
      res.status(404).json({ error: 'Survey draft not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
