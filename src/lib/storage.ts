import type { StoredParticipant } from './types';

const hostKey = (roomCode: string) => `simul:host:${roomCode}`;
const participantKey = (roomCode: string) => `simul:participant:${roomCode}`;
const draftKey = (roomCode: string, participantId: string, roundId: string) =>
  `simul:draft:${roomCode}:${participantId}:${roundId}`;

export function getHostToken(roomCode: string) {
  return localStorage.getItem(hostKey(roomCode));
}

export function setHostToken(roomCode: string, token: string) {
  localStorage.setItem(hostKey(roomCode), token);
}

export function getStoredParticipant(roomCode: string): StoredParticipant | null {
  const raw = localStorage.getItem(participantKey(roomCode));

  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredParticipant;
  } catch {
    localStorage.removeItem(participantKey(roomCode));
    return null;
  }
}

export function setStoredParticipant(roomCode: string, participant: StoredParticipant) {
  localStorage.setItem(participantKey(roomCode), JSON.stringify(participant));
}

export function getStoredDraft(roomCode: string, participantId: string, roundId: string): string[] | null {
  const raw = localStorage.getItem(draftKey(roomCode, participantId, roundId));

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    localStorage.removeItem(draftKey(roomCode, participantId, roundId));
    return null;
  }
}

export function setStoredDraft(roomCode: string, participantId: string, roundId: string, answers: string[]) {
  localStorage.setItem(draftKey(roomCode, participantId, roundId), JSON.stringify(answers));
}
