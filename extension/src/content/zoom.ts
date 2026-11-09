import { run, texts } from './base.ts';

// ponytail: סלקטורים של Zoom Web Client, ספטמבר 2026. כשנשבר, לתקן כאן בלבד.
const SEL = {
  leaveButton: 'button[aria-label*="Leave" i], .footer-button__leave-btn, button[aria-label*="End" i]',
  participantName: '.participants-item__display-name, .video-avatar__avatar-name, [class*="display-name"]',
  activeSpeaker: '.speaker-active-container__video-frame .video-avatar__avatar-name, [class*="active"] .video-avatar__avatar-name',
  title: '.meeting-info-container__topic, [class*="meeting-topic"]',
};

run({
  platform: 'zoom',
  inCall: () => location.pathname.startsWith('/wc/') && !!document.querySelector(SEL.leaveButton),
  title: () => document.querySelector(SEL.title)?.textContent?.trim() || document.title.replace(/\s*[-–]\s*Zoom$/, '').trim(),
  participants: () => texts(SEL.participantName),
  activeSpeaker: () => document.querySelector(SEL.activeSpeaker)?.textContent?.trim() || undefined,
});
