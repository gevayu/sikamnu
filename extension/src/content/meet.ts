import { run, texts } from './base.ts';

// ponytail: סלקטורים של Google Meet, ספטמבר 2026. כשנשבר, לתקן כאן בלבד.
const SEL = {
  leaveButton: 'button[aria-label*="Leave call" i], button[aria-label*="יציאה מהשיחה"], button[aria-label*="עזיבת השיחה"]',
  participantTile: '[data-participant-id]',
  participantName: '[data-participant-id] [data-self-name], [data-participant-id] span[jsname]',
  // Meet מצייר גל קול ליד הדובר. ה-tile שמכיל אותו הוא הדובר.
  speakingIndicator: '[data-participant-id] [class*="speaking" i], [data-participant-id] div[jscontroller][aria-hidden="true"] svg',
};

run({
  platform: 'meet',
  inCall: () => /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(location.pathname) && !!document.querySelector(SEL.leaveButton),
  title: () => document.title.replace(/^Meet\s*[-–]\s*/, '').replace(/\s*[-–]\s*Google Meet$/, '').trim(),
  participants: () => texts(SEL.participantName),
  activeSpeaker: () => {
    const ind = document.querySelector(SEL.speakingIndicator);
    const tile = ind?.closest<HTMLElement>(SEL.participantTile);
    return tile?.querySelector(SEL.participantName)?.textContent?.trim() || undefined;
  },
});
