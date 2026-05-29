import { useState, useEffect } from 'react';
import Hero from '../components/Hero.jsx';
import SurveyCard from '../components/SurveyCard.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { STORAGE_KEY, SECTIONS } from '../data/questions.js';
import { isAnswered } from '../utils/surveyUtils.js';
import { readDraftForRespondent } from '../utils/draftStorage.js';

export default function SurveyHome({ onStartSurvey, respondent }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    try {
      const draft = readDraftForRespondent(STORAGE_KEY, respondent);
      if (draft) {
        const answers = draft.answers || {};
        const skipped = draft.skipped || {};

        let totalAnswered = 0;
        let totalQuestions = 0;

        SECTIONS.forEach(section => {
          section.qs.forEach(qnum => {
            totalQuestions++;
            if (isAnswered(qnum, answers, skipped)) {
              totalAnswered++;
            }
          });
        });

        const progressPercent = totalQuestions > 0 ? Math.round((totalAnswered / totalQuestions) * 100) : 0;
        setProgress(progressPercent);
      } else {
        setProgress(0);
      }
    } catch (error) {
      console.error('Error calculating progress:', error);
    }
  }, [respondent]);

  return (
    <main>
      <Hero onStartSurvey={onStartSurvey} />
      <section className="home-summary" id="dashboard">
        <SurveyCard title="Questions" value="75" detail="Across 15 focused sections" />
        <SurveyCard title="Sections" value="15" detail="From current state to future outlook" />
        <SurveyCard title="Estimated Time" value="10-15 min" detail="Save and continue as needed" />
        <ProgressBar value={progress} label="Survey completion" />
      </section>
    </main>
  );
}
