export type RoomMode = 'free_text' | 'ranking' | 'wheel';

export type Room = {
  id: string;
  code: string;
  title: string;
  mode: RoomMode;
  is_blind: boolean;
  max_answers: number;
  revealed_at: string | null;
  created_at: string;
};

export type RoomRound = {
  id: string;
  room_id: string;
  round_number: number;
  title: string;
  mode: RoomMode;
  is_blind: boolean;
  max_answers: number;
  revealed_at: string | null;
  created_at: string;
};

export type RoomOption = {
  id: string;
  room_id: string;
  round_id: string;
  label: string;
  sort_order: number;
  created_at: string;
};

export type Participant = {
  id: string;
  room_id: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
};

export type SubmissionStatus = {
  room_id: string;
  round_id: string;
  participant_id: string;
  answer_count: number;
  submitted_at: string;
  updated_at: string;
};

export type Submission = {
  room_id: string;
  round_id: string;
  participant_id: string;
  answers: string[];
  submitted_at: string;
  updated_at: string;
};

export type WheelResult = {
  room_id: string;
  round_id: string;
  selected_option_id: string;
  spin_started_at: string;
  spin_duration_ms: number;
  spin_seed: string;
  created_at: string;
};

export type RoomSnapshot = {
  room: Room;
  currentRound: RoomRound;
  rounds: RoomRound[];
  options: RoomOption[];
  allOptions: RoomOption[];
  participants: Participant[];
  statuses: SubmissionStatus[];
  allStatuses: SubmissionStatus[];
  submissions: Submission[];
  allSubmissions: Submission[];
  currentWheelResult: WheelResult | null;
  wheelResults: WheelResult[];
};

export type CreateRoomInput = {
  title: string;
  mode: RoomMode;
  isBlind: boolean;
  maxAnswers: number;
  options: string[];
};

export type CreatedRoom = {
  room_id: string;
  room_code: string;
  host_token: string;
};

export type StartedRound = {
  round_id: string;
  round_number: number;
};

export type JoinedRoom = {
  participant_id: string;
  participant_token: string;
};

export type StoredParticipant = {
  id: string;
  token: string;
  name: string;
};
