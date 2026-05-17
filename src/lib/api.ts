import { requireSupabase, supabase } from './supabase';
import type {
  CreatedRoom,
  CreateRoomInput,
  JoinedRoom,
  Room,
  RoomOption,
  RoomRound,
  RoomSnapshot,
  StartedRound,
  Submission,
  SubmissionStatus,
  Participant,
  WheelResult,
} from './types';

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function formatRoomCode(value: string) {
  const code = normalizeRoomCode(value);
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function getRoomUrl(roomCode: string) {
  return `${window.location.origin}/room/${normalizeRoomCode(roomCode)}`;
}

function firstRpcRow<T>(data: T[] | T | null): T {
  if (Array.isArray(data)) {
    if (!data[0]) throw new Error('No data returned from Supabase.');
    return data[0];
  }

  if (!data) throw new Error('No data returned from Supabase.');
  return data;
}

export async function createRoom(input: CreateRoomInput) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_room', {
    p_title: input.title,
    p_mode: input.mode,
    p_is_blind: input.isBlind,
    p_max_answers: input.maxAnswers,
    p_options: input.options,
  });

  if (error) throw error;
  return firstRpcRow<CreatedRoom>(data);
}

export async function joinRoom(roomCode: string, displayName: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('join_room', {
    p_room_code: normalizeRoomCode(roomCode),
    p_display_name: displayName,
  });

  if (error) throw error;
  return firstRpcRow<JoinedRoom>(data);
}

export async function saveSubmission(
  roomCode: string,
  participantId: string,
  participantToken: string,
  answers: string[],
) {
  const client = requireSupabase();
  const { error } = await client.rpc('save_submission', {
    p_room_code: normalizeRoomCode(roomCode),
    p_participant_id: participantId,
    p_participant_token: participantToken,
    p_answers: answers,
  });

  if (error) throw error;
}

export async function revealRoom(roomCode: string, hostToken: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('reveal_room', {
    p_room_code: normalizeRoomCode(roomCode),
    p_host_token: hostToken,
  });

  if (error) throw error;
}

export async function startNextRound(roomCode: string, hostToken: string, input: CreateRoomInput) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('start_next_round', {
    p_room_code: normalizeRoomCode(roomCode),
    p_host_token: hostToken,
    p_title: input.title,
    p_mode: input.mode,
    p_is_blind: input.isBlind,
    p_max_answers: input.maxAnswers,
    p_options: input.options,
  });

  if (error) throw error;
  return firstRpcRow<StartedRound>(data);
}

export async function spinWheel(roomCode: string, hostToken: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('spin_wheel', {
    p_room_code: normalizeRoomCode(roomCode),
    p_host_token: hostToken,
  });

  if (error) throw error;
  return firstRpcRow<WheelResult>(data);
}

export async function fetchRoomSnapshot(roomCode: string): Promise<RoomSnapshot> {
  const client = requireSupabase();
  const normalizedCode = normalizeRoomCode(roomCode);

  const { data: room, error: roomError } = await client
    .from('rooms')
    .select('*')
    .eq('code', normalizedCode)
    .maybeSingle<Room>();

  if (roomError) throw roomError;
  if (!room) throw new Error('Room not found.');

  const [roundsResult, optionsResult, wheelResultsResult, participantsResult, statusesResult, submissionsResult] =
    await Promise.all([
      client
        .from('room_rounds')
        .select('*')
        .eq('room_id', room.id)
        .order('round_number', { ascending: true })
        .returns<RoomRound[]>(),
      client
        .from('room_options')
        .select('*')
        .eq('room_id', room.id)
        .order('round_id', { ascending: true })
        .order('sort_order', { ascending: true })
        .returns<RoomOption[]>(),
      client
        .from('wheel_results')
        .select('*')
        .eq('room_id', room.id)
        .order('spin_started_at', { ascending: true })
        .returns<WheelResult[]>(),
      client
        .from('participants')
        .select('*')
        .eq('room_id', room.id)
        .order('created_at', { ascending: true })
        .returns<Participant[]>(),
      client
        .from('submission_status')
        .select('*')
        .eq('room_id', room.id)
        .returns<SubmissionStatus[]>(),
      client.from('submissions').select('*').eq('room_id', room.id).returns<Submission[]>(),
    ]);

  if (roundsResult.error) throw roundsResult.error;
  if (optionsResult.error) throw optionsResult.error;
  if (wheelResultsResult.error) throw wheelResultsResult.error;
  if (participantsResult.error) throw participantsResult.error;
  if (statusesResult.error) throw statusesResult.error;
  if (submissionsResult.error) throw submissionsResult.error;

  const rounds = roundsResult.data ?? [];
  const currentRound = rounds[rounds.length - 1];

  if (!currentRound) throw new Error('Room has no active round.');

  const allOptions = optionsResult.data ?? [];
  const wheelResults = wheelResultsResult.data ?? [];
  const allStatuses = statusesResult.data ?? [];
  const allSubmissions = submissionsResult.data ?? [];

  return {
    room,
    currentRound,
    rounds,
    options: allOptions.filter((option) => option.round_id === currentRound.id),
    allOptions,
    participants: participantsResult.data ?? [],
    statuses: allStatuses.filter((status) => status.round_id === currentRound.id),
    allStatuses,
    submissions: allSubmissions.filter((submission) => submission.round_id === currentRound.id),
    allSubmissions,
    currentWheelResult: wheelResults.find((result) => result.round_id === currentRound.id) ?? null,
    wheelResults,
  };
}

export function subscribeToRoom(room: Room, onChange: () => void) {
  if (!supabase) return () => undefined;
  const client = supabase;

  let timer: number | undefined;
  const queueRefresh = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 120);
  };

  const channel = client
    .channel(`room:${room.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, queueRefresh)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_rounds', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_options', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wheel_results', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'submission_status', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'submissions', filter: `room_id=eq.${room.id}` },
      queueRefresh,
    )
    .subscribe();

  return () => {
    if (timer) window.clearTimeout(timer);
    client.removeChannel(channel);
  };
}
