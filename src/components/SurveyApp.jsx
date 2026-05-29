import { useState, useEffect, useCallback, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { apiClient } from '../api/client.js';

import { SECTIONS, QUESTIONS, AUTOFILL_RULES, STORAGE_KEY } from '../data/questions.js';

function questionAppliesToRole(q, roleCode) {
  if (!q) return false;
  const applicability = String(q.applicability || 'ALL')
    .split(',')
    .map(item => item.trim().toUpperCase());

  return applicability.includes('ALL') || applicability.includes(String(roleCode || '').toUpperCase());
}

function getFilteredSections(roleCode) {
  return SECTIONS
    .map(section => ({
      ...section,
      qs: section.qs.filter(qnum => questionAppliesToRole(QUESTIONS[qnum], roleCode)),
    }))
    .filter(section => section.qs.length > 0);
}
const SKIP_LABEL = 'Skipped — prefer not to answer';

/* -- Utils -- */
function isAnswered(qnum, answers, skipped) {
  const v = answers[qnum];
  const q = QUESTIONS[qnum];
  if (!q) return false;
  if (skipped[qnum]) return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'object' && v !== null) {
    if (q.type === 'likert') return q.rows.every((_, i) => v[i] != null && v[i] !== '');
    if (q.type === 'ranking') {
      const filled = Object.values(v).filter(Boolean).length;
      return filled >= q.items.length;
    }
    return Object.keys(v).length > 0;
  }
  return v != null;
}

function orderFromRankMap(items, val) {
  if (!val || !Object.keys(val).length) return items.map((_, i) => i);
  return [...items.keys()].sort((a, b) => {
    const ra = parseInt(val[a], 10) || 999;
    const rb = parseInt(val[b], 10) || 999;
    return ra - rb;
  });
}

function rankMapFromOrder(order) {
  const map = {};
  order.forEach((itemIdx, pos) => { map[itemIdx] = String(pos + 1); });
  return map;
}

function defaultRankingOrder(items) {
  return items.map((_, i) => i);
}

function getRankBadgeClass(rank) {
  if (rank >= 1 && rank <= 10) return `rank-${rank}`;
  return 'rank-n';
}

function typeHint(q) {
  if (q.type === 'mcq') return q.single ? (q.maxSelect ? `Select up to ${q.maxSelect}` : 'Single choice') : 'Multiple choice';
  if (q.type === 'likert') return 'Rate 1 (low) to 5 (high)';
  if (q.type === 'ranking') return q.rankTop ? `Drag to reorder - top ${q.rankTop} highlighted` : 'Drag to order by priority';
  if (q.type === 'open') return 'Open text';
  return '';
}

function getAnswerDisplay(qnum, answers, skipped) {
  if (skipped && skipped[qnum]) return SKIP_LABEL;
  const q = QUESTIONS[qnum];
  const val = answers[qnum];
  if (!val) return '';
  if (q.type === 'mcq') return Array.isArray(val) ? val.join(', ') : val;
  if (q.type === 'likert') {
    return Object.entries(val).map(([ri, v]) =>
      `${(q.rows[ri] || '').slice(0, 28)}...: ${v}/5`
    ).join(' | ');
  }
  if (q.type === 'ranking') {
    const order = orderFromRankMap(q.items, val);
    const top = q.rankTop || order.length;
    return order.slice(0, top).map((idx, i) => `${i + 1}. ${q.items[idx]}`).join(' | ');
  }
  if (q.type === 'open') return val.length > 80 ? val.slice(0, 80) + '...' : val;
  return '';
}

function downloadConfirmedAnswersPdf(confirmed, confirmedSnapshot, sections = SECTIONS) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (height) => {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeBlock = (text, { size = 10, style = 'normal', color = [30, 30, 46], gap = 4 } = {}) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text || ''), maxWidth);
    const lineHeight = size * 0.42;
    ensureSpace(lines.length * lineHeight + gap);
    doc.text(lines, margin, y);
    y += lines.length * lineHeight + gap;
  };

  writeBlock('India Warehousing Ecosystem Survey 2026', { size: 18, style: 'bold', gap: 6 });
  writeBlock('Confirmed responses summary', { size: 13, style: 'bold', gap: 4 });
  writeBlock('Generated: ' + new Date().toLocaleString(), { size: 9, color: [100, 100, 120], gap: 10 });

  let questionCount = 0;
  sections.forEach(s => {
    const items = s.qs.filter(q => confirmed[q]);
    if (!items.length) return;
    ensureSpace(14);
    writeBlock(`Section ${s.num}: ${s.title}`, { size: 12, style: 'bold', color: [37, 99, 235], gap: 6 });
    items.forEach(qnum => {
      questionCount += 1;
      const q = QUESTIONS[qnum];
      const answer = confirmedSnapshot[qnum] || SKIP_LABEL;
      ensureSpace(18);
      writeBlock(`Q${qnum}`, { size: 9, style: 'bold', gap: 2 });
      if (q) writeBlock(q.label, { size: 9, color: [80, 80, 100], gap: 3 });
      writeBlock('Answer: ' + answer, { size: 10, style: 'bold', color: [22, 101, 52], gap: 8 });
    });
  });

  if (!questionCount) {
    writeBlock('No confirmed answers were recorded.', { size: 11, gap: 6 });
  }

  const footerY = pageHeight - 10;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 160);
  doc.text(`${questionCount} confirmed response(s)`, margin, footerY);

  doc.save('warehousing_survey_confirmed_answers.pdf');
}

/* -- Toast -- */
function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast${t.type ? ' ' + t.type : ''}`}>{t.msg}</div>
      ))}
    </div>
  );
}

/* -- Drag and drop ranking -- */
function RankingDragDrop({ q, value, onChange, disabled }) {
  const defaultOrder = defaultRankingOrder(q.items);
  const [order, setOrder] = useState(() => orderFromRankMap(q.items, value));
  const dragItem = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const rankTop = q.rankTop != null ? q.rankTop : q.items.length;

  useEffect(() => {
    const rankCount = value ? Object.keys(value).filter(k => value[k]).length : 0;
    if (rankCount < q.items.length) {
      const initial = rankMapFromOrder(defaultOrder);
      setOrder(defaultOrder);
      onChange(initial);
    } else {
      setOrder(orderFromRankMap(q.items, value));
    }
  }, [q.label]);

  const commit = (newOrder) => {
    setOrder(newOrder);
    onChange(rankMapFromOrder(newOrder));
  };

  const onDragStart = (e, listIdx) => {
    if (disabled) return;
    dragItem.current = listIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(listIdx));
    requestAnimationFrame(() => e.target.closest('.rank-dnd-item')?.classList.add('dragging'));
  };

  const onDragEnd = (e) => {
    e.target.closest('.rank-dnd-item')?.classList.remove('dragging');
    dragItem.current = null;
    setDragOver(null);
  };

  const onDragOver = (e, listIdx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(listIdx);
  };

  const onDrop = (e, targetIdx) => {
    e.preventDefault();
    const from = dragItem.current;
    if (from == null || from === targetIdx) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(targetIdx, 0, moved);
    commit(next);
    setDragOver(null);
    dragItem.current = null;
  };

  const renderItem = (itemIdx, listIdx) => {
    const rank = listIdx + 1;
    const isPriority = q.rankTop != null && listIdx < rankTop;
    const badgeClass = getRankBadgeClass(rank);
    const isDouble = rank >= 10;
    return (
      <div
        key={itemIdx}
        role="listitem"
        className={`rank-dnd-item ranked-top${isPriority ? ' rank-priority' : ' rank-rest'}${dragOver === listIdx ? ' drag-over' : ''}`}
        draggable={!disabled}
        onDragStart={(e) => onDragStart(e, listIdx)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOver(e, listIdx)}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => onDrop(e, listIdx)}
      >
        <span className="rank-drag-handle" aria-hidden="true">::</span>
        <span
          className={`rank-badge ${badgeClass}${isDouble ? ' rank-double' : ''}`}
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
        <span className="rank-dnd-label">{q.items[itemIdx]}</span>
        {q.rankTop != null && q.items.length > rankTop && isPriority && (
          <span className="rank-priority-tag">Top {rankTop}</span>
        )}
      </div>
    );
  };

  return (
    <div className="rank-dnd">
      <div className="rank-dnd-hint">
        <span className="rank-drag-handle" aria-hidden="true">::</span>
        <span>
          {q.rankTop != null
            ? `All ${q.items.length} choices are ranked. Drag to reorder - positions 1-${rankTop} are your top priorities.`
            : `Drag to order all ${q.items.length} items (1 = highest priority)`}
        </span>
      </div>
      {q.rankTop != null && q.items.length > rankTop && (
        <div className="rank-dnd-note">
          Every option starts ranked 1{'\u2013'}{q.items.length}. Highlighted rows are your top {rankTop}.
        </div>
      )}
      <div className="rank-dnd-list" role="list">
        {order.map((itemIdx, listIdx) => renderItem(itemIdx, listIdx))}
      </div>
    </div>
  );
}

/* -- Question types -- */
function McqQuestion({ q, qnum, value, onChange, autofilled, confirmed }) {
  const isAF = autofilled && !confirmed;
  const toggle = (opt) => {
    if (q.single) onChange(opt);
    else {
      const arr = Array.isArray(value) ? [...value] : [];
      const i = arr.indexOf(opt);
      if (i > -1) arr.splice(i, 1);
      else {
        if (q.maxSelect && arr.length >= q.maxSelect) return { error: `Maximum ${q.maxSelect} selections` };
        arr.push(opt);
      }
      onChange(arr);
    }
  };

  return (
    <div className="options-grid">
      {q.options.map((opt, i) => {
        const selected = q.single ? value === opt : (Array.isArray(value) && value.includes(opt));
        const suggested = isAF && q.single && autofilled === opt;
        return (
          <div
            key={opt}
            className={`opt${selected ? ' selected' : ''}`}
            onClick={() => {
              const r = toggle(opt);
              if (r?.error) window.__showToast?.(r.error);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(opt); } }}
            tabIndex={0}
            role="button"
          >
            {q.single ? <span className="opt-key">{i < 9 ? i + 1 : '*'}</span> : <input type="checkbox" readOnly checked={selected} tabIndex={-1} />}
            <span>{opt}</span>
            {suggested && <span className="autofill-badge">suggested</span>}
          </div>
        );
      })}
      {q.maxSelect && (
        <p className="q-type-hint" style={{ marginTop: 8 }}>
          Selected: {Array.isArray(value) ? value.length : 0} / {q.maxSelect}
        </p>
      )}
    </div>
  );
}

function LikertQuestion({ q, value, onChange, disabled }) {
  const val = value || {};
  return (
    <div className="likert-wrap">
      <div className="likert-legend"><span>1 = Very low</span><span>5 = Very high</span></div>
      {q.rows.map((row, ri) => (
        <div key={ri} className="likert-row-block">
          <div className="likert-stmt">{row}</div>
          <div className="likert-btns">
            {['1', '2', '3', '4', '5'].map(n => (
              <button
                key={n}
                type="button"
                className={`likert-btn${val[ri] == n ? ' selected' : ''}`}
                disabled={disabled}
                onClick={() => onChange({ ...val, [ri]: n })}
              >{n}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuestionBlock({ qnum, answers, confirmed, autofilled, skipped, onAnswer, onConfirm, onSkip, onBlurOpen }) {
  const q = QUESTIONS[qnum];
  if (!q) return null;
  const isSkipped = !!skipped[qnum];
  const answered = isAnswered(qnum, answers, skipped);
  const isConfirmed = !!confirmed[qnum];
  const isAF = autofilled[qnum] && !isConfirmed;
  const value = answers[qnum];

  return (
    <div id={`q-block-${qnum}`} className={`q-block${answered ? ' answered' : ''}${isConfirmed ? ' confirmed-q' : ''}${isSkipped ? ' skipped-q' : ''}`}>
      <div className="q-label">
        <span className="q-num">Q{qnum}</span>
        <span>
          {q.label}
          {isAF && <span className="autofill-badge"> * suggested</span>}
        </span>
      </div>
      <div className="q-meta">
        <span className="q-applicability">{q.applicability}</span>
        <span className="q-type-hint">{typeHint(q)}</span>
      </div>
      {isSkipped && <div className="skipped-banner">You skipped this question. Change any answer below to answer it instead.</div>}

      {q.type === 'mcq' && (
        <McqQuestion q={q} qnum={qnum} value={value} onChange={onAnswer} autofilled={autofilled[qnum]} confirmed={isConfirmed} />
      )}
      {q.type === 'likert' && (
        <LikertQuestion q={q} value={value} onChange={onAnswer} disabled={false} />
      )}
      {q.type === 'ranking' && (
        <RankingDragDrop q={q} value={value} onChange={onAnswer} disabled={false} />
      )}
      {q.type === 'open' && (
        <>
          <textarea
            className="open-q"
            value={value || ''}
            placeholder="Share your thoughts here..."
            rows={4}
            onChange={(e) => onAnswer(e.target.value)}
            onBlur={onBlurOpen}
          />
          <div className="char-count">{(value || '').length} characters</div>
        </>
      )}

      <div className="q-actions">
        <button
          type="button"
          className={`skip-btn${isSkipped ? ' skipped-active' : ''}`}
          onClick={onSkip}
          disabled={isSkipped}
        >
          {isSkipped ? 'Skipped' : 'Skip this question'}
        </button>
      </div>
    </div>
  );
}

/* -- Welcome -- */
function WelcomeScreen({ hasDraft, onStart, onRestore, onClear }) {
  return (
    <div className="screen-overlay">
      <div className="screen-card">
        <h1>India Warehousing Ecosystem Survey 2026</h1>
        <p className="subtitle">Help shape policy and industry strategy. Your responses are confidential.</p>
        <div className="stats-row">
          <div className="stat-chip"><strong>75</strong> questions</div>
          <div className="stat-chip"><strong>15</strong> sections</div>
          <div className="stat-chip"><strong>25-45</strong> min</div>
        </div>
        {hasDraft && (
          <div className="restore-banner">
            <span>Saved draft found from a previous session.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} onClick={onRestore}>Resume draft</button>
              <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }} onClick={onClear}>Start fresh</button>
            </div>
          </div>
        )}
        <button className="btn-primary" onClick={onStart}>Start survey {'\u2192'}</button>
      </div>
    </div>
  );
}

/* -- Section complete popup -- */
function SectionCompleteModal({ data, onClose, onNext }) {
  if (!data) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="section-complete-title">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">{'\u2713'}</div>
        <h2 id="section-complete-title">Section {data.num} complete!</h2>
        <p className="modal-section-name">{data.title}</p>
        <p className="modal-detail">
          You have answered all <strong>{data.total}</strong> questions in this section.
        </p>
        {!data.isLast && data.nextTitle && (
          <p className="modal-next">Up next: <strong>{data.nextTitle}</strong></p>
        )}
        {data.isLast && (
          <p className="modal-next">You are on the final section. Click finish when ready.</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Stay on this section</button>
          {!data.isLast ? (
            <button type="button" className="btn-primary" onClick={onNext}>Next section {'\u2192'}</button>
          ) : (
            <button type="button" className="btn-primary" onClick={onClose}>Continue</button>
          )}
        </div>
      </div>
    </div>
  );
}

function RequiredQuestionModal({ data, onClose, onGoToQuestion }) {
  if (!data) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="required-question-title">
      <div className="modal-card required-question-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon modal-warning">!</div>
        <h2 id="required-question-title">Question needs attention</h2>
        <p className="modal-detail">
          Please answer and confirm every question before moving ahead:
        </p>
        <div className="modal-question-list">
          {data.questions.map(({ qnum, label }) => (
            <button key={qnum} type="button" onClick={() => onGoToQuestion(qnum)}>
              <strong>Q{qnum}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="modal-next">
          If a question is not relevant, use Skip this question. Skipped questions are confirmed automatically.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>Stay on this section</button>
        </div>
      </div>
    </div>
  );
}

/* -- Complete -- */
function CompleteScreen({ stats, confirmed, confirmedSnapshot, sections, onExport, onRestart, onSubmit }) {
  const [referrals, setReferrals] = useState([{ name: '', email: '', organization: '', contactNo: '' }]);
  const [submittingReferrals, setSubmittingReferrals] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const sectionQuestions = sections.flatMap(section => section.qs);
  const confirmedCount = sectionQuestions.filter(qnum => confirmed[qnum]).length;

  const validateEmail = (email) => {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateContactNo = (contactNo) => {
    if (!contactNo) return true; // Optional field
    const phoneRegex = /^[\d\s+\-()]{10,}$/; // At least 10 digits
    return phoneRegex.test(contactNo.replace(/\s/g, ''));
  };

  const updateReferral = (index, field, value) => {
    const updated = [...referrals];
    updated[index] = { ...updated[index], [field]: value };
    setReferrals(updated);

    // Clear error for this field
    const errorKey = `${index}-${field}`;
    if (validationErrors[errorKey]) {
      const newErrors = { ...validationErrors };
      delete newErrors[errorKey];
      setValidationErrors(newErrors);
    }
  };

  const addReferral = () => {
    setReferrals([...referrals, { name: '', email: '', organization: '', contactNo: '' }]);
  };

  const removeReferral = (index) => {
    setReferrals(referrals.filter((_, i) => i !== index));
  };

  const submitReferrals = async () => {
    const filledReferrals = referrals.filter(r => r.name || r.email || r.organization || r.contactNo);
    const errors = {};

    // Validate filled referrals
    filledReferrals.forEach((ref, index) => {
      if (ref.email && !validateEmail(ref.email)) {
        errors[`${referrals.indexOf(ref)}-email`] = 'Please enter a valid email address';
      }
      if (ref.contactNo && !validateContactNo(ref.contactNo)) {
        errors[`${referrals.indexOf(ref)}-contactNo`] = 'Please enter a valid contact number (at least 10 digits)';
      }
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      window.__showToast?.('Please fix validation errors', '');
      return;
    }

    setSubmittingReferrals(true);
    try {
      if (filledReferrals.length > 0) {
        await apiClient.saveReferrals(filledReferrals);
        window.__showToast?.('Referrals saved successfully', 'success');
      }
      onSubmit();
    } catch (error) {
      window.__showToast?.('Error saving referrals: ' + error.message, '');
      setSubmittingReferrals(false);
    }
  };

  return (
    <div className="screen-overlay complete-screen-overlay">
      <div className="screen-card complete-card-wide">
        <div style={{ fontSize: 48, marginBottom: '0.5rem', textAlign: 'center' }}>{'\u2713'}</div>
        <h1 style={{ textAlign: 'center' }}>Thank you!</h1>
        <p className="subtitle" style={{ textAlign: 'center' }}>Your responses have been recorded.</p>
        <div className="complete-stats">
          <div className="complete-stat"><div className="n">{stats.answered}</div><div>Answered</div></div>
          <div className="complete-stat"><div className="n">{stats.confirmed}</div><div>Confirmed</div></div>
          <div className="complete-stat"><div className="n">{sections.length}</div><div>Sections</div></div>
        </div>
        {confirmedCount > 0 ? (
          <div className="complete-summary">
            <h2 className="complete-summary-title">Your confirmed responses</h2>
            <p className="complete-summary-note">Below is what you confirmed during the survey (including skipped questions).</p>
            {sections.map(s => {
              const items = s.qs.filter(q => confirmed[q]);
              if (!items.length) return null;
              return (
                <div key={s.num} className="complete-summary-section">
                  <h3 className="complete-summary-section-title">Section {s.num}: {s.title}</h3>
                  {items.map(qnum => {
                    const q = QUESTIONS[qnum];
                    return (
                      <div key={qnum} className="complete-summary-item">
                        <div className="complete-q-num">Q{qnum}</div>
                        <div className="complete-q-label">{q ? q.label : ''}</div>
                        <div className="complete-q-answer">{confirmedSnapshot[qnum] || SKIP_LABEL}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="complete-summary-empty">No confirmed answers to show. Confirmed responses appear here when you use <strong>Confirm answer</strong> during the survey.</p>
        )}

        <div className="referral-section" style={{ marginTop: '3rem', padding: '2rem', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '12px', boxShadow: '0 10px 30px rgba(102, 126, 234, 0.2)' }}>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem', color: 'white', fontWeight: 700 }}>Help Us Reach More People</h2>
          <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.9)', marginBottom: '2rem', lineHeight: '1.6' }}>
            Know someone who should also take this survey? Share their contact details and help us improve the quality of this research.
          </p>

          <div className="referrals-list" style={{ marginBottom: '1.5rem' }}>
            {referrals.map((ref, index) => (
              <div key={index} style={{ marginBottom: '1.5rem', padding: '1.5rem', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>Name (Optional)</span>
                    <input
                      type="text"
                      placeholder="Contact name"
                      value={ref.name}
                      onChange={(e) => updateReferral(index, 'name', e.target.value)}
                      style={{ padding: '0.7rem', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.95rem', transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                      onFocus={(e) => e.target.style.borderColor = '#667eea'}
                      onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>Email (Optional)</span>
                    <input
                      type="email"
                      placeholder="contact@example.com"
                      value={ref.email}
                      onChange={(e) => updateReferral(index, 'email', e.target.value)}
                      style={{ padding: '0.7rem', border: validationErrors[`${index}-email`] ? '2px solid #ef4444' : '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.95rem', transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                      onFocus={(e) => !validationErrors[`${index}-email`] && (e.target.style.borderColor = '#667eea')}
                      onBlur={(e) => e.target.style.borderColor = validationErrors[`${index}-email`] ? '#ef4444' : '#e5e7eb'}
                    />
                    {validationErrors[`${index}-email`] && <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem' }}>{validationErrors[`${index}-email`]}</span>}
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>Organization (Optional)</span>
                    <input
                      type="text"
                      placeholder="Company or organization"
                      value={ref.organization}
                      onChange={(e) => updateReferral(index, 'organization', e.target.value)}
                      style={{ padding: '0.7rem', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.95rem', transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                      onFocus={(e) => e.target.style.borderColor = '#667eea'}
                      onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>Contact No (Optional)</span>
                    <input
                      type="tel"
                      placeholder="+91 XXXXX XXXXX"
                      value={ref.contactNo}
                      onChange={(e) => updateReferral(index, 'contactNo', e.target.value)}
                      style={{ padding: '0.7rem', border: validationErrors[`${index}-contactNo`] ? '2px solid #ef4444' : '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.95rem', transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                      onFocus={(e) => !validationErrors[`${index}-contactNo`] && (e.target.style.borderColor = '#667eea')}
                      onBlur={(e) => e.target.style.borderColor = validationErrors[`${index}-contactNo`] ? '#ef4444' : '#e5e7eb'}
                    />
                    {validationErrors[`${index}-contactNo`] && <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem' }}>{validationErrors[`${index}-contactNo`]}</span>}
                  </label>
                </div>
                {referrals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeReferral(index)}
                    style={{ fontSize: '0.85rem', color: '#667eea', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontWeight: 500, transition: 'color 0.2s' }}
                    onMouseEnter={(e) => e.target.style.color = '#764ba2'}
                    onMouseLeave={(e) => e.target.style.color = '#667eea'}
                  >
                    Remove this contact
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addReferral}
            style={{ fontSize: '0.9rem', padding: '0.7rem 1.2rem', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '6px', cursor: 'pointer', marginBottom: '1.5rem', fontWeight: 500, transition: 'all 0.3s ease' }}
            onMouseEnter={(e) => { e.target.style.backgroundColor = 'rgba(255,255,255,0.3)'; e.target.style.borderColor = 'rgba(255,255,255,0.6)'; }}
            onMouseLeave={(e) => { e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'; e.target.style.borderColor = 'rgba(255,255,255,0.4)'; }}
          >
            + Add another contact
          </button>

          <div style={{ padding: '1.2rem', backgroundColor: 'rgba(255,255,255,0.15)', borderLeft: '4px solid white', borderRadius: '6px', marginTop: '1.5rem', backdropFilter: 'blur(10px)' }}>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.95)', margin: 0, lineHeight: '1.6', fontWeight: 500 }}>
              <strong>🔒 Privacy Assurance:</strong> Any information shared will be kept strictly confidential and used only for the purpose of this survey. Your contacts' privacy and data security are important to us.
            </p>
          </div>
        </div>

        <div className="complete-actions" style={{ marginTop: '2rem' }}>
          <button type="button" className="btn-primary" onClick={onExport}>Download PDF</button>
          <button type="button" className="btn-secondary" onClick={submitReferrals} disabled={submittingReferrals} style={{ marginRight: 8 }}>
            {submittingReferrals ? 'Saving...' : 'Share Contacts & Finish'}
          </button>
          <button type="button" className="btn-secondary" onClick={onRestart}>Start over</button>
        </div>
      </div>
    </div>
  );
}

/* -- Main App -- */
export default function App({ initialScreen = 'welcome', respondent, onFinish }) {
  const [screen, setScreen] = useState(initialScreen);
  const [answers, setAnswers] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [confirmedSnapshot, setConfirmedSnapshot] = useState({});
  const [autofilled, setAutofilled] = useState({});
  const [skipped, setSkipped] = useState({});
  const [sectionIdx, setSectionIdx] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [sectionPopup, setSectionPopup] = useState(null);
  const [requiredPopup, setRequiredPopup] = useState(null);
  const saveTimer = useRef(null);
  const popupTimer = useRef(null);
  const confirmedRef = useRef(confirmed);
  const mainContentRef = useRef(null);

  const scrollQuestionsToTop = useCallback(() => {
    const scrollTarget = mainContentRef.current;
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    confirmedRef.current = confirmed;
  }, [confirmed]);

  useEffect(() => {
    return () => {
      if (popupTimer.current) {
        clearTimeout(popupTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (popupTimer.current) {
      clearTimeout(popupTimer.current);
    }
  }, [sectionIdx]);
  const activeSections = getFilteredSections(respondent?.roleCode);
  const activeQuestionNums = activeSections.flatMap(section => section.qs);
  const activeQuestionTotal = activeQuestionNums.length;
  const activeSectionTotal = activeSections.length;
  const totalAnswered = activeQuestionNums.filter(qnum => isAnswered(qnum, answers, skipped)).length;
  const pct = activeQuestionTotal ? Math.round((totalAnswered / activeQuestionTotal) * 100) : 0;

  const showToast = useCallback((msg, type = '') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  useEffect(() => { window.__showToast = showToast; }, [showToast]);

  const saveDraft = useCallback((showMsg) => {
    try {
      const draftData = {
        answers, confirmed, confirmedSnapshot, autofilled, skipped, currentSectionIdx: sectionIdx, savedAt: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draftData));

      apiClient.saveSurvey(respondent, answers, confirmed, confirmedSnapshot, skipped, {
        currentSectionIdx: sectionIdx,
        totalAnswered: totalAnswered,
        totalQuestions: activeQuestionTotal
      }).catch(err => console.error('Backend save failed:', err));

      if (showMsg) showToast('Progress saved', 'success');
    } catch { if (showMsg) showToast('Could not save'); }
  }, [answers, confirmed, confirmedSnapshot, autofilled, skipped, sectionIdx, showToast, respondent, totalAnswered, activeQuestionTotal]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(false), 700);
  }, [saveDraft]);

  useEffect(() => {
    const d = localStorage.getItem(STORAGE_KEY);
    if (d) {
      try {
        const p = JSON.parse(d);
        if (Object.keys(p.answers || {}).length > 2) setHasDraft(true);
      } catch { /* ignore */ }
    }
  }, []);

  const applyDraft = (draft) => {
    const ans = draft.answers || {};
    const conf = draft.confirmed || {};
    setAnswers(ans);
    setConfirmed(conf);
    if (draft.confirmedSnapshot) {
      setConfirmedSnapshot(draft.confirmedSnapshot);
    } else {
      const snap = {};
      Object.keys(conf).forEach(k => {
        const qnum = +k;
        if (conf[qnum]) snap[qnum] = getAnswerDisplay(qnum, ans, draft.skipped || {});
      });
      setConfirmedSnapshot(snap);
    }
    setAutofilled(draft.autofilled || {});
    setSkipped(draft.skipped || {});
    setSectionIdx(draft.currentSectionIdx || 0);
  };

  const showSectionCompletePopup = (qnum) => {
    const section = activeSections[sectionIdx];
    if (!section) return;
    const lastQ = section.qs[section.qs.length - 1];
    if (qnum !== lastQ) return;

    if (popupTimer.current) {
      clearTimeout(popupTimer.current);
    }

    const allConfirmed = section.qs.every(q => confirmedRef.current[q] || q === qnum);
    if (!allConfirmed) return;
    const p = getSectionProgress(section);

    popupTimer.current = setTimeout(() => {
      const currentSection = activeSections[sectionIdx];
      if (!currentSection) return;
      const allStillConfirmed = currentSection.qs.every(q => confirmedRef.current[q]);
      if (!allStillConfirmed) return;

      const currentProgress = getSectionProgress(currentSection);
      setSectionPopup({
        num: currentSection.num,
        title: currentSection.title,
        total: currentProgress.total,
        isLast: sectionIdx === activeSectionTotal - 1,
        nextTitle: sectionIdx < activeSectionTotal - 1 ? activeSections[sectionIdx + 1].title : null,
      });
    }, 1500);
  };

  const confirmQuestion = (qnum) => {
    if (!isAnswered(qnum, answers, skipped)) {
      showToast('Please answer the question first');
      return;
    }
    const wasConfirmed = !!confirmed[qnum];
    setConfirmed(c => ({ ...c, [qnum]: true }));
    setConfirmedSnapshot(s => ({ ...s, [qnum]: getAnswerDisplay(qnum, answers, skipped) }));
    scheduleSave();
    showToast(wasConfirmed ? 'Answer updated' : 'Answer confirmed', 'success');
    if (!wasConfirmed) showSectionCompletePopup(qnum);
  };

  const skipQuestion = (qnum) => {
    const q = QUESTIONS[qnum];
    if (!q) return;
    const wasConfirmed = !!confirmed[qnum];
    setSkipped(s => ({ ...s, [qnum]: true }));
    setAnswers(prev => {
      const next = { ...prev };
      if (q.type === 'mcq') next[qnum] = q.skipOption || SKIP_LABEL;
      else if (q.type === 'likert') delete next[qnum];
      else delete next[qnum];
      return next;
    });
    setConfirmed(c => ({ ...c, [qnum]: true }));
    setConfirmedSnapshot(s => ({ ...s, [qnum]: SKIP_LABEL }));
    scheduleSave();
    showToast('Question skipped', 'success');
    if (!wasConfirmed) showSectionCompletePopup(qnum);
  };

  const checkAutofills = useCallback((changedQ, ans) => {
    const nextAF = { ...autofilled };
    const nextAns = { ...ans };
    Object.entries(AUTOFILL_RULES).forEach(([qnum, rule]) => {
      if (rule.from.includes(changedQ)) {
        const argMap = {};
        rule.from.forEach(n => { argMap[n] = nextAns[n]; });
        const suggestion = rule.fn(argMap);
        if (suggestion) {
          nextAF[qnum] = suggestion;
          if (!nextAns[qnum]) nextAns[qnum] = suggestion;
        }
      }
    });
    setAutofilled(nextAF);
    return nextAns;
  }, [autofilled]);

  const setAnswer = (qnum, val) => {
    // 1. Clear skipped status for this question
    setSkipped(s => {
      if (!s[qnum]) return s;
      const n = { ...s };
      delete n[qnum];
      return n;
    });

    // 2. Update answer and apply autofills
    setAnswers(prev => {
      let next = { ...prev, [qnum]: val };
      next = checkAutofills(qnum, next);
      return next;
    });

    const localNextAnswers = checkAutofills(qnum, { ...answers, [qnum]: val });
    const isFullyAnswered = isAnswered(qnum, localNextAnswers, skipped);

    // 3. Auto-confirm the answer ONLY if it is fully answered
    const wasConfirmed = !!confirmed[qnum];
    setConfirmed(c => {
      if (isFullyAnswered) {
        return { ...c, [qnum]: true };
      } else {
        if (!c[qnum]) return c;
        const nextConfirmed = { ...c };
        delete nextConfirmed[qnum];
        return nextConfirmed;
      }
    });

    // 4. Update confirmed snapshot with display representation if fully answered, otherwise remove it
    setConfirmedSnapshot(s => {
      if (isFullyAnswered) {
        const displayVal = getAnswerDisplay(qnum, localNextAnswers, skipped);
        return { ...s, [qnum]: displayVal };
      } else {
        if (!s[qnum]) return s;
        const nextSnapshot = { ...s };
        delete nextSnapshot[qnum];
        return nextSnapshot;
      }
    });

    scheduleSave();

    // 5. If the question is now fully answered and wasn't confirmed before, check if section is complete
    // Trigger popup for non-open questions with debounce. Open questions are handled on blur.
    const q = QUESTIONS[qnum];
    if (isFullyAnswered && q) {
      if (q.type !== 'open') {
        showSectionCompletePopup(qnum);
      }
    } else {
      // If it is no longer fully answered, clear any pending popup timer
      if (popupTimer.current) {
        clearTimeout(popupTimer.current);
      }
    }
  };


  const getSectionProgress = (sec) => {
    const done = sec.qs.filter(q => isAnswered(q, answers, skipped)).length;
    return { done, total: sec.qs.length, pct: Math.round((done / sec.qs.length) * 100) };
  };

  useEffect(() => {
    if (sectionIdx > activeSectionTotal - 1) {
      setSectionIdx(Math.max(activeSectionTotal - 1, 0));
    }
  }, [activeSectionTotal, sectionIdx]);

  const sec = activeSections[sectionIdx] || activeSections[0];

  const goNextSection = () => {
    setSectionPopup(null);
    if (sectionIdx < activeSectionTotal - 1) {
      setSectionIdx(i => i + 1);
      scrollQuestionsToTop();
    }
  };

  const getMissingQuestions = (section) => (
    section.qs
      .filter(qnum => !isAnswered(qnum, answers, skipped) || !confirmed[qnum])
      .map(qnum => ({
        qnum,
        label: QUESTIONS[qnum]?.label || 'Untitled question',
      }))
  );

  const showRequiredQuestions = (missingQuestions) => {
    setRequiredPopup({ questions: missingQuestions });
    const firstQuestion = missingQuestions[0]?.qnum;
    if (firstQuestion) {
      setTimeout(() => {
        document.getElementById('q-block-' + firstQuestion)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };

  const goToMissingQuestion = (qnum) => {
    setRequiredPopup(null);
    document.getElementById('q-block-' + qnum)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleAdvanceSection = () => {
    const missingQuestions = getMissingQuestions(sec);

    if (missingQuestions.length) {
      showToast('Please confirm every answer before moving ahead');
      showRequiredQuestions(missingQuestions);
      return;
    }

    if (sectionIdx < activeSectionTotal - 1) {
      setSectionIdx(i => i + 1);
      scrollQuestionsToTop();
    } else {
      saveDraft(false);
      setScreen('complete');
      onFinish?.();
    }
  };

  if (screen === 'welcome') {
    return (
      <>
        <WelcomeScreen
          hasDraft={hasDraft}
          onStart={() => {
            const d = localStorage.getItem(STORAGE_KEY);
            if (d) try { applyDraft(JSON.parse(d)); } catch { /* */ }
            setScreen('survey');
          }}
          onRestore={() => {
            const d = localStorage.getItem(STORAGE_KEY);
            if (d) applyDraft(JSON.parse(d));
            setScreen('survey');
          }}
          onClear={() => {
            localStorage.removeItem(STORAGE_KEY);
            setHasDraft(false);
            setAnswers({});
            setConfirmed({});
            setConfirmedSnapshot({});
            setAutofilled({});
            setSkipped({});
            setSectionIdx(0);
            setScreen('survey');
          }}
        />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  if (screen === 'complete') {
    return (
      <>
        <CompleteScreen
          stats={{
            answered: totalAnswered,
            confirmed: activeQuestionNums.filter(qnum => confirmed[qnum]).length
          }}
          confirmed={confirmed}
          confirmedSnapshot={confirmedSnapshot}
          sections={activeSections}
          onExport={() => {
            const confirmedCount = activeQuestionNums.filter(qnum => confirmed[qnum]).length;
            if (!confirmedCount) {
              showToast('No confirmed answers to download', '');
              return;
            }
            try {
              downloadConfirmedAnswersPdf(confirmed, confirmedSnapshot, activeSections);
              showToast('PDF downloaded', 'success');
            } catch {
              showToast('Could not create PDF. Check your connection and try again.', '');
            }
          }}
          onSubmit={async () => {
            try {
              showToast('Submitting survey...', '');
              const draftSurvey = await apiClient.getDraft();
              if (draftSurvey._id) {
                await apiClient.submitSurvey(draftSurvey._id);
                showToast('Survey submitted successfully!', 'success');
                setTimeout(() => window.location.reload(), 1500);
              }
            } catch (error) {
              showToast('Error submitting survey: ' + error.message, '');
            }
          }}
          onRestart={() => window.location.reload()}
        />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  const prog = getSectionProgress(sec);

  return (
    <div className="survey-app">
      <header className="top-bar">
        <div className="top-bar-inner">
          <button type="button" className="icon-btn mobile-menu-btn" onClick={() => { setSidebarOpen(true); setRightOpen(false); }} aria-label="Sections">{'\u2630'}</button>
          <h1>Warehousing Survey 2026</h1>
          {respondent?.role && <span className="respondent-role">{respondent.role}</span>}
          <div className="progress-wrap">
            <div className="progress-meta">
              <span>{totalAnswered} of {activeQuestionTotal} answered</span>
              <span>{pct}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: pct + '%' }} />
            </div>
          </div>
          <div className="top-actions">
            <button type="button" className="icon-btn" onClick={() => { setRightOpen(true); setSidebarOpen(false); }} aria-label="Confirmed">{'\u2713'}</button>
            <button type="button" className="icon-btn save-btn" onClick={() => saveDraft(true)} aria-label="Save">Save</button>
          </div>
        </div>
      </header>

      <div className={`overlay-backdrop${sidebarOpen || rightOpen ? ' open' : ''}`} onClick={() => { setSidebarOpen(false); setRightOpen(false); }} />

      <div className="survey-body">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-title">Sections</div>
          {activeSections.map((s, i) => {
            const p = getSectionProgress(s);
            return (
              <button
                key={s.num}
                type="button"
                className={`section-item${i === sectionIdx ? ' active' : ''}${p.pct === 100 ? ' done' : ''}`}
                onClick={() => { setSectionIdx(i); setSidebarOpen(false); scrollQuestionsToTop(); }}
              >
                <span className="section-dot">{s.num}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{p.done}/{p.total}</span>
                  <div className="section-mini-bar"><div className="section-mini-fill" style={{ width: p.pct + '%' }} /></div>
                </span>
              </button>
            );
          })}
        </aside>

        <main className="main-content" ref={mainContentRef}>
          <div className="section-header">
            <span className="badge">Section {sectionIdx + 1} of {activeSectionTotal}</span>
            <h2>{sec.title}</h2>
            <p>{sec.qs.length} questions | {prog.done} of {prog.total} completed</p>
          </div>
          <div className="section-tip">{sec.tip}</div>
          {sec.qs.map(qnum => (
            <QuestionBlock
              key={qnum}
              qnum={qnum}
              answers={answers}
              confirmed={confirmed}
              autofilled={autofilled}
              skipped={skipped}
              onAnswer={(val) => setAnswer(qnum, val)}
              onConfirm={() => confirmQuestion(qnum)}
              onSkip={() => skipQuestion(qnum)}
              onBlurOpen={() => showSectionCompletePopup(qnum)}
            />
          ))}
        </main>

        <aside className={`right-panel${rightOpen ? ' open' : ''}`}>
          <h3><span style={{ color: 'var(--success)' }}>{'\u2713'}</span> Confirmed answers</h3>
          {!Object.keys(confirmed).length ? (
            <div className="confirmed-empty">Select an answer and click <strong>Confirm</strong> to see it here. You can edit your answer and confirm again to update.</div>
          ) : (
            activeSections.map(s => {
              const items = s.qs.filter(q => confirmed[q]);
              if (!items.length) return null;
              return (
                <div key={s.num}>
                  <div className="confirmed-section-title">S{s.num} - {s.title}</div>
                  {items.map(qnum => (
                    <div
                      key={qnum}
                      className="confirmed-item"
                      onClick={() => {
                        const idx = activeSections.findIndex(x => x.qs.includes(qnum));
                        if (idx >= 0) setSectionIdx(idx);
                        setRightOpen(false);
                        setTimeout(() => document.getElementById('q-block-' + qnum)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                      }}
                    >
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>Q{qnum}</div>
                      <div style={{ fontWeight: 500 }}>{confirmedSnapshot[qnum] || '-'}</div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </aside>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          <button type="button" className="btn-secondary" disabled={sectionIdx === 0} onClick={() => { setSectionIdx(i => i - 1); scrollQuestionsToTop(); }}>{'\u2190'} Previous</button>
          <span className="section-counter">Section <strong>{sectionIdx + 1}</strong> of {activeSectionTotal}</span>
          <div className="nav-group">
            <button type="button" className="btn-primary" onClick={handleAdvanceSection}>
              {sectionIdx === activeSectionTotal - 1 ? 'Finish survey \u2713' : 'Next section \u2192'}
            </button>
          </div>
        </div>
      </nav>

      <SectionCompleteModal
        data={sectionPopup}
        onClose={() => setSectionPopup(null)}
        onNext={goNextSection}
      />
      <RequiredQuestionModal
        data={requiredPopup}
        onClose={() => setRequiredPopup(null)}
        onGoToQuestion={goToMissingQuestion}
      />
      <ToastContainer toasts={toasts} />
    </div>
  );
}
