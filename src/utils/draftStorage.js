import { safeStorage } from './safeStorage.js';

export function getRespondentDraftKey(respondent) {
  const key = respondent?.username || respondent?.email;
  return key ? String(key).trim().toLowerCase() : '';
}

export function isDraftForRespondent(draft, respondent) {
  const respondentKey = getRespondentDraftKey(respondent);
  if (!respondentKey) return false;
  return draft?.respondentKey === respondentKey;
}

export function readDraftForRespondent(storageKey, respondent) {
  try {
    const rawDraft = safeStorage.getItem(storageKey);
    if (!rawDraft) return null;

    const draft = JSON.parse(rawDraft);
    return isDraftForRespondent(draft, respondent) ? draft : null;
  } catch (error) {
    console.error('Error reading survey draft:', error);
    return null;
  }
}

