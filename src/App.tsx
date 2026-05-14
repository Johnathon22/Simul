import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Eye,
  EyeOff,
  History,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Users,
} from 'lucide-react';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  createRoom,
  fetchRoomSnapshot,
  formatRoomCode,
  getRoomUrl,
  joinRoom,
  normalizeRoomCode,
  revealRoom,
  saveSubmission,
  startNextRound,
  subscribeToRoom,
} from './lib/api';
import { isSupabaseConfigured } from './lib/supabase';
import {
  getHostToken,
  getStoredDraft,
  getStoredParticipant,
  setHostToken,
  setStoredDraft,
  setStoredParticipant,
} from './lib/storage';
import type { RoomMode, RoomOption, RoomRound, RoomSnapshot, StoredParticipant, Submission } from './lib/types';

type Route = { name: 'home' } | { name: 'room'; code: string };

function parseRoute(): Route {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9-]+)/);

  if (match) {
    return { name: 'room', code: normalizeRoomCode(match[1]) };
  }

  return { name: 'home' };
}

function Button({
  children,
  icon,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`button ${variant}`} type={type} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Field({
  label,
  children,
  helper,
}: {
  label: string;
  children: ReactNode;
  helper?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper ? <small>{helper}</small> : null}
    </label>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setRoute(parseRoute());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} aria-label="Go to Simul home">
          <span className="brand-mark">S</span>
          <span>Simul</span>
        </button>
      </header>

      {route.name === 'home' ? (
        <HomePage navigate={navigate} />
      ) : (
        <RoomPage roomCode={route.code} navigate={navigate} />
      )}
    </div>
  );
}

function HomePage({ navigate }: { navigate: (to: string) => void }) {
  const [mode, setMode] = useState<'choice' | 'create' | 'join'>('choice');
  const [joinCode, setJoinCode] = useState('');

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeRoomCode(joinCode);

    if (code) navigate(`/room/${code}`);
  };

  return (
    <main className="home">
      <section className="intro">
        <div>
          <h1>Say it at the same time.</h1>
          <p>
            Create a room, let everyone lock in their answer privately, then reveal the group at once.
          </p>
        </div>
        <div className="intro-actions">
          <Button icon={<Plus size={18} />} onClick={() => setMode('create')}>
            Create room
          </Button>
          <Button icon={<DoorOpen size={18} />} variant="secondary" onClick={() => setMode('join')}>
            Join room
          </Button>
        </div>
      </section>

      {!isSupabaseConfigured ? <SetupNotice /> : null}

      {mode === 'choice' ? (
        <section className="quick-panel">
          <div className="quick-item">
            <Crown size={20} />
            <span>Hosts choose the format and reveal timing.</span>
          </div>
          <div className="quick-item">
            <EyeOff size={20} />
            <span>Answers stay hidden until reveal.</span>
          </div>
          <div className="quick-item">
            <Users size={20} />
            <span>Guests join with a link or room code.</span>
          </div>
        </section>
      ) : null}

      {mode === 'join' ? (
        <section className="panel narrow-panel">
          <h2>Join a room</h2>
          <form className="stack" onSubmit={submitJoin}>
            <Field label="Room code">
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(formatRoomCode(event.target.value))}
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
                placeholder="ABC 23"
              />
            </Field>
            <Button icon={<DoorOpen size={18} />} type="submit" disabled={!normalizeRoomCode(joinCode)}>
              Join room
            </Button>
          </form>
        </section>
      ) : null}

      {mode === 'create' ? <CreateRoomForm navigate={navigate} /> : null}
    </main>
  );
}

function SetupNotice() {
  return (
    <section className="setup-notice" role="status">
      <strong>Supabase setup needed</strong>
      <span>
        Add your project URL and anon key to <code>.env</code>, then run the SQL in{' '}
        <code>supabase/schema.sql</code>.
      </span>
    </section>
  );
}

function CreateRoomForm({ navigate }: { navigate: (to: string) => void }) {
  const [title, setTitle] = useState('');
  const [roomMode, setRoomMode] = useState<RoomMode>('free_text');
  const [isBlind, setIsBlind] = useState(false);
  const [maxAnswers, setMaxAnswers] = useState(1);
  const [optionsText, setOptionsText] = useState('Pizza\nSushi\nBurgers');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(
    () =>
      optionsText
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean),
    [optionsText],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!isSupabaseConfigured) {
      setError('Supabase is not configured yet.');
      return;
    }

    if (roomMode === 'ranking' && options.length < 2) {
      setError('Ranking rooms need at least 2 options.');
      return;
    }

    try {
      setIsCreating(true);
      const created = await createRoom({
        title: title.trim() || 'Untitled room',
        mode: roomMode,
        isBlind,
        maxAnswers,
        options,
      });
      setHostToken(created.room_code, created.host_token);
      navigate(`/room/${created.room_code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create room.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="panel create-panel">
      <div className="section-heading">
        <h2>Create a room</h2>
        <span>Host view</span>
      </div>

      <form className="stack" onSubmit={submit}>
        <Field label="Decision name">
          <input
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Dinner tonight"
          />
        </Field>

        <div className="field">
          <span>Answer type</span>
          <div className="segmented">
            <button
              type="button"
              className={roomMode === 'free_text' ? 'active' : ''}
              onClick={() => setRoomMode('free_text')}
            >
              Write answers
            </button>
            <button
              type="button"
              className={roomMode === 'ranking' ? 'active' : ''}
              onClick={() => setRoomMode('ranking')}
            >
              Rank choices
            </button>
          </div>
        </div>

        {roomMode === 'free_text' ? (
          <Field label="Answers per person" helper="Use 1 for a single true pick, or up to 5 for a shortlist.">
            <div className="stepper">
              <button type="button" onClick={() => setMaxAnswers((value) => Math.max(1, value - 1))}>
                -
              </button>
              <strong>{maxAnswers}</strong>
              <button type="button" onClick={() => setMaxAnswers((value) => Math.min(5, value + 1))}>
                +
              </button>
            </div>
          </Field>
        ) : (
          <Field label="Choices" helper="One option per line. Everyone will rank the same list.">
            <textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} rows={5} />
          </Field>
        )}

        <label className="switch-row">
          <input type="checkbox" checked={isBlind} onChange={(event) => setIsBlind(event.target.checked)} />
          <span>
            <strong>Blind reveal</strong>
            <small>Show answers without names.</small>
          </span>
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <Button icon={<Plus size={18} />} type="submit" disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create room'}
        </Button>
      </form>
    </section>
  );
}

function RoomPage({ roomCode, navigate }: { roomCode: string; navigate: (to: string) => void }) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [participant, setParticipant] = useState<StoredParticipant | null>(() => getStoredParticipant(roomCode));
  const [hostToken, setLocalHostToken] = useState<string | null>(() => getHostToken(roomCode));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRoom = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured yet.');
      setIsLoading(false);
      return;
    }

    try {
      const data = await fetchRoomSnapshot(roomCode);
      setSnapshot(data);
      setParticipant(getStoredParticipant(roomCode));
      setLocalHostToken(getHostToken(roomCode));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load room.');
    } finally {
      setIsLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    setIsLoading(true);
    loadRoom();
  }, [loadRoom]);

  useEffect(() => {
    if (!snapshot?.room) return undefined;
    return subscribeToRoom(snapshot.room, loadRoom);
  }, [snapshot?.room, loadRoom]);

  if (isLoading) {
    return (
      <main className="room-page">
        <section className="panel state-panel">
          <span className="loader" />
          <p>Opening room...</p>
        </section>
      </main>
    );
  }

  if (error || !snapshot) {
    return (
      <main className="room-page">
        <section className="panel state-panel">
          <h1>Room unavailable</h1>
          <p>{error || 'This room could not be found.'}</p>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back home
          </Button>
        </section>
      </main>
    );
  }

  const inviteUrl = getRoomUrl(snapshot.room.code);
  const submittedCount = snapshot.statuses.length;
  const participantCount = snapshot.participants.length;
  const isRevealed = Boolean(snapshot.currentRound.revealed_at);

  return (
    <main className="room-page">
      <section className="room-hero">
        <div>
          <span className="room-code">{formatRoomCode(snapshot.room.code)}</span>
          <h1>{snapshot.room.title}</h1>
          <p>
            {isRevealed
              ? `Round ${snapshot.currentRound.round_number} is revealed.`
              : `Round ${snapshot.currentRound.round_number}: ${snapshot.currentRound.title} · ${submittedCount} of ${participantCount} submitted`}
          </p>
        </div>
        <div className="room-hero-actions">
          <CopyButton text={inviteUrl} label="Copy link" />
          <CopyButton text={snapshot.room.code} label="Copy code" variant="secondary" />
        </div>
      </section>

      <div className="room-layout">
        <section className="panel main-panel">
          {isRevealed ? (
            <>
              {!participant ? <JoinRoomCard roomCode={snapshot.room.code} onJoined={setParticipant} /> : null}
              <ResultsPanel snapshot={snapshot} />
              {hostToken ? (
                <NextRoundPanel snapshot={snapshot} hostToken={hostToken} onStarted={loadRoom} />
              ) : (
                <WaitingForNextRound />
              )}
              <PastRoundsPanel snapshot={snapshot} />
            </>
          ) : (
            <>
              {participant ? (
                <SubmissionPanel
                  key={snapshot.currentRound.id}
                  snapshot={snapshot}
                  participant={participant}
                  onSubmitted={loadRoom}
                />
              ) : (
                <JoinRoomCard roomCode={snapshot.room.code} onJoined={setParticipant} />
              )}

              {hostToken ? (
                <HostPanel snapshot={snapshot} hostToken={hostToken} onReveal={loadRoom} />
              ) : null}
              <PastRoundsPanel snapshot={snapshot} />
            </>
          )}
        </section>

        <aside className="side-stack">
          <section className="panel qr-panel">
            <div className="section-heading">
              <h2>Invite</h2>
              <QrCode size={18} />
            </div>
            <div className="qr-box">
              <QRCodeSVG value={inviteUrl} size={148} />
            </div>
            <p>{inviteUrl.replace(/^https?:\/\//, '')}</p>
          </section>

          <PeoplePanel snapshot={snapshot} />
        </aside>
      </div>
    </main>
  );
}

function CopyButton({
  text,
  label,
  variant = 'ghost',
}: {
  text: string;
  label: string;
  variant?: 'secondary' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Button icon={copied ? <Check size={17} /> : <Copy size={17} />} variant={variant} onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

function JoinRoomCard({
  roomCode,
  onJoined,
}: {
  roomCode: string;
  onJoined: (participant: StoredParticipant) => void;
}) {
  const [name, setName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    try {
      setIsJoining(true);
      const joined = await joinRoom(roomCode, name);
      const stored = {
        id: joined.participant_id,
        token: joined.participant_token,
        name: name.trim() || 'Guest',
      };
      setStoredParticipant(roomCode, stored);
      onJoined(stored);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join room.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="action-block">
      <div className="section-heading">
        <h2>Join this room</h2>
        <Users size={18} />
      </div>
      <form className="stack" onSubmit={submit}>
        <Field label="Your name">
          <input
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex"
            autoComplete="name"
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button icon={<DoorOpen size={18} />} type="submit" disabled={isJoining}>
          {isJoining ? 'Joining...' : 'Join'}
        </Button>
      </form>
    </div>
  );
}

function SubmissionPanel({
  snapshot,
  participant,
  onSubmitted,
}: {
  snapshot: RoomSnapshot;
  participant: StoredParticipant;
  onSubmitted: () => void;
}) {
  const existingStatus = snapshot.statuses.find(
    (status) => status.round_id === snapshot.currentRound.id && status.participant_id === participant.id,
  );
  const [answers, setAnswers] = useState<string[]>(() => {
    const stored = getStoredDraft(snapshot.room.code, participant.id, snapshot.currentRound.id);

    if (stored?.length) return stored;
    if (snapshot.currentRound.mode === 'ranking') return snapshot.options.map((option) => option.id);

    return Array.from({ length: snapshot.currentRound.max_answers }, () => '');
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (snapshot.currentRound.mode === 'ranking') {
      const optionIds = new Set(snapshot.options.map((option) => option.id));
      setAnswers((current) => {
        const validAnswers = current.filter((answer) => optionIds.has(answer));
        const missing = snapshot.options.map((option) => option.id).filter((id) => !validAnswers.includes(id));
        return [...validAnswers, ...missing];
      });
    }
  }, [snapshot.options, snapshot.currentRound.mode]);

  const updateAnswer = (index: number, value: string) => {
    setAnswers((current) => current.map((answer, answerIndex) => (answerIndex === index ? value : answer)));
  };

  const moveRanking = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= answers.length) return;
    setAnswers((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    const cleanAnswers =
      snapshot.currentRound.mode === 'free_text' ? answers.map((answer) => answer.trim()).filter(Boolean) : answers;

    if (!cleanAnswers.length) {
      setError('Add at least one answer.');
      return;
    }

    try {
      setIsSaving(true);
      await saveSubmission(snapshot.room.code, participant.id, participant.token, cleanAnswers);
      setStoredDraft(snapshot.room.code, participant.id, snapshot.currentRound.id, cleanAnswers);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="action-block">
      <div className="section-heading">
        <div>
          <h2>{existingStatus ? 'Edit your answer' : 'Your answer'}</h2>
          <span>
            Round {snapshot.currentRound.round_number} · {participant.name}
          </span>
        </div>
        {existingStatus ? <Check className="status-icon" size={18} /> : <Send size={18} />}
      </div>

      <form className="stack" onSubmit={submit}>
        {snapshot.currentRound.mode === 'free_text' ? (
          <div className="answer-list">
            {answers.map((answer, index) => (
              <Field
                key={index}
                label={answers.length === 1 ? 'Answer' : `Answer ${index + 1}`}
                helper={index === 0 ? undefined : 'Optional'}
              >
                <input
                  value={answer}
                  maxLength={160}
                  onChange={(event) => updateAnswer(index, event.target.value)}
                  placeholder={index === 0 ? 'Your true pick' : 'Another option'}
                />
              </Field>
            ))}
          </div>
        ) : (
          <RankingEditor options={snapshot.options} order={answers} onMove={moveRanking} />
        )}

        {existingStatus ? <p className="success-note">Submitted. You can change it until reveal.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        <Button icon={<Send size={18} />} type="submit" disabled={isSaving}>
          {isSaving ? 'Submitting...' : existingStatus ? 'Update answer' : 'Submit answer'}
        </Button>
      </form>
    </div>
  );
}

function RankingEditor({
  options,
  order,
  onMove,
}: {
  options: RoomOption[];
  order: string[];
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const optionById = new Map(options.map((option) => [option.id, option]));

  return (
    <div className="ranking-list">
      {order.map((optionId, index) => {
        const option = optionById.get(optionId);
        if (!option) return null;

        return (
          <div className="ranking-row" key={option.id}>
            <span className="rank-number">{index + 1}</span>
            <strong>{option.label}</strong>
            <div className="rank-actions">
              <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label="Move up">
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => onMove(index, 1)}
                disabled={index === order.length - 1}
                aria-label="Move down"
              >
                <ArrowDown size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HostPanel({
  snapshot,
  hostToken,
  onReveal,
}: {
  snapshot: RoomSnapshot;
  hostToken: string;
  onReveal: () => void;
}) {
  const [isRevealing, setIsRevealing] = useState(false);
  const [error, setError] = useState('');

  const reveal = async () => {
    setError('');

    try {
      setIsRevealing(true);
      await revealRoom(snapshot.room.code, hostToken);
      onReveal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reveal room.');
    } finally {
      setIsRevealing(false);
    }
  };

  return (
    <div className="host-block">
      <div className="section-heading">
        <div>
          <h2>Host controls</h2>
          <span>
            {snapshot.statuses.length} of {snapshot.participants.length} submitted
          </span>
        </div>
        <Crown size={18} />
      </div>

      <div className="host-flags">
        <span>
          Round {snapshot.currentRound.round_number}:{' '}
          {snapshot.currentRound.mode === 'ranking' ? 'Ranking' : `Top ${snapshot.currentRound.max_answers}`}
        </span>
        <span>{snapshot.currentRound.is_blind ? 'Blind' : 'Named'}</span>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <Button icon={<Eye size={18} />} variant="danger" onClick={reveal} disabled={isRevealing}>
        {isRevealing ? 'Revealing...' : 'Reveal all'}
      </Button>
    </div>
  );
}

function NextRoundPanel({
  snapshot,
  hostToken,
  onStarted,
}: {
  snapshot: RoomSnapshot;
  hostToken: string;
  onStarted: () => void;
}) {
  const nextRoundNumber = snapshot.currentRound.round_number + 1;
  const seedOptions = useMemo(() => getSeedOptions(snapshot), [snapshot]);
  const [title, setTitle] = useState(`Round ${nextRoundNumber}`);
  const [roomMode, setRoomMode] = useState<RoomMode>('free_text');
  const [isBlind, setIsBlind] = useState(snapshot.currentRound.is_blind);
  const [maxAnswers, setMaxAnswers] = useState(1);
  const [optionsText, setOptionsText] = useState(seedOptions.join('\n'));
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(
    () =>
      optionsText
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean),
    [optionsText],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (roomMode === 'ranking' && options.length < 2) {
      setError('Ranking rounds need at least 2 options.');
      return;
    }

    try {
      setIsStarting(true);
      await startNextRound(snapshot.room.code, hostToken, {
        title: title.trim() || `Round ${nextRoundNumber}`,
        mode: roomMode,
        isBlind,
        maxAnswers,
        options,
      });
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start next round.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="next-round-block">
      <div className="section-heading">
        <div>
          <h2>Set up a new round</h2>
          <span>Round {nextRoundNumber} · same room, same link</span>
        </div>
        <RotateCcw size={18} />
      </div>
      <p className="round-setup-note">
        Choose the format just like a fresh room. Everyone already inside will move to this round automatically.
      </p>

      <form className="stack" onSubmit={submit}>
        <Field label="Round name">
          <input
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Final shortlist"
          />
        </Field>

        <div className="field">
          <span>Answer type</span>
          <div className="segmented">
            <button
              type="button"
              className={roomMode === 'free_text' ? 'active' : ''}
              onClick={() => setRoomMode('free_text')}
            >
              Write answers
            </button>
            <button
              type="button"
              className={roomMode === 'ranking' ? 'active' : ''}
              onClick={() => setRoomMode('ranking')}
            >
              Rank choices
            </button>
          </div>
        </div>

        {roomMode === 'free_text' ? (
          <Field label="Answers per person" helper="Use 1 for the final pick, or up to 5 for a shortlist.">
            <div className="stepper">
              <button type="button" onClick={() => setMaxAnswers((value) => Math.max(1, value - 1))}>
                -
              </button>
              <strong>{maxAnswers}</strong>
              <button type="button" onClick={() => setMaxAnswers((value) => Math.min(5, value + 1))}>
                +
              </button>
            </div>
          </Field>
        ) : (
          <Field label="Choices" helper="One option per line.">
            <textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} rows={5} />
          </Field>
        )}

        <label className="switch-row">
          <input type="checkbox" checked={isBlind} onChange={(event) => setIsBlind(event.target.checked)} />
          <span>
            <strong>Blind reveal</strong>
            <small>Show answers without names.</small>
          </span>
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <Button icon={<RotateCcw size={18} />} type="submit" disabled={isStarting}>
          {isStarting ? 'Starting...' : 'Start next round'}
        </Button>
      </form>
    </div>
  );
}

function WaitingForNextRound() {
  return (
    <div className="next-wait">
      <h2>Waiting for the next round</h2>
      <p>The host can start another round with the same people and link.</p>
    </div>
  );
}

function PastRoundsPanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const pastRounds = snapshot.rounds.filter((round) => round.id !== snapshot.currentRound.id && round.revealed_at);

  if (!pastRounds.length) return null;

  return (
    <div className="round-history">
      <div className="section-heading">
        <h2>Past rounds</h2>
        <History size={18} />
      </div>

      <div className="round-history-list">
        {pastRounds.map((round) => (
          <RoundSummary key={round.id} round={round} snapshot={snapshot} />
        ))}
      </div>
    </div>
  );
}

function RoundSummary({ round, snapshot }: { round: RoomRound; snapshot: RoomSnapshot }) {
  const options = snapshot.allOptions.filter((option) => option.round_id === round.id);
  const submissions = snapshot.allSubmissions.filter((submission) => submission.round_id === round.id);

  return (
    <article className="round-summary">
      <div className="round-summary-head">
        <strong>
          Round {round.round_number}: {round.title}
        </strong>
        <span>{round.mode === 'ranking' ? 'Ranking' : `Top ${round.max_answers}`}</span>
      </div>

      {submissions.length ? (
        <RoundResultsTable
          round={round}
          options={options}
          submissions={submissions}
          participants={snapshot.participants}
          compact
        />
      ) : (
        <p className="muted">No submissions were revealed.</p>
      )}
    </article>
  );
}

function getSeedOptions(snapshot: RoomSnapshot) {
  const values =
    snapshot.currentRound.mode === 'ranking'
      ? snapshot.options.map((option) => option.label)
      : snapshot.submissions.flatMap((submission) => submission.answers);

  const seen = new Set<string>();
  const unique = values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.length >= 2 ? unique : ['Option 1', 'Option 2'];
}

function PeoplePanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const submittedIds = new Set(snapshot.statuses.map((status) => status.participant_id));

  return (
    <section className="panel people-panel">
      <div className="section-heading">
        <h2>People</h2>
        <Users size={18} />
      </div>

      {snapshot.participants.length ? (
        <div className="people-list">
          {snapshot.participants.map((participant) => (
            <div className="person-row" key={participant.id}>
              <span>{participant.display_name}</span>
              {submittedIds.has(participant.id) ? <Check size={16} /> : <span className="waiting-dot" />}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No one has joined yet.</p>
      )}
    </section>
  );
}

function ResultsPanel({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <div className="results-panel">
      <div className="section-heading">
        <div>
          <h2>Revealed answers</h2>
          <span>
            Round {snapshot.currentRound.round_number} · {snapshot.currentRound.is_blind ? 'Blind reveal' : 'Named reveal'}
          </span>
        </div>
        {snapshot.currentRound.is_blind ? <EyeOff size={18} /> : <Eye size={18} />}
      </div>

      {snapshot.submissions.length ? (
        <RoundResultsTable
          round={snapshot.currentRound}
          options={snapshot.options}
          submissions={snapshot.submissions}
          participants={snapshot.participants}
        />
      ) : (
        <p className="muted">No submissions were revealed.</p>
      )}
    </div>
  );
}

function RoundResultsTable({
  round,
  options,
  submissions,
  participants,
  compact = false,
}: {
  round: RoomRound;
  options: RoomOption[];
  submissions: Submission[];
  participants: RoomSnapshot['participants'];
  compact?: boolean;
}) {
  const optionById = new Map(options.map((option) => [option.id, option.label]));
  const rows = getSubmissionRows(submissions, participants, round, optionById);
  const columnCount = getResultColumnCount(round, options, submissions);
  const columns = Array.from({ length: columnCount }, (_, index) =>
    round.mode === 'ranking' ? `Rank ${index + 1}` : `Pick ${index + 1}`,
  );
  const ranked = round.mode === 'ranking' ? getRankingScores(options, submissions) : [];

  return (
    <div className={compact ? 'results-stack compact-results' : 'results-stack'}>
      {round.mode === 'ranking' && ranked.length ? (
        <div className="consensus-list" aria-label="Consensus ranking">
          {ranked.map((item, index) => (
            <div className="consensus-row" key={item.option.id}>
              <span className="rank-number">{index + 1}</span>
              <strong>{item.option.label}</strong>
              <small>{item.score} pts</small>
            </div>
          ))}
        </div>
      ) : null}

      <div className="result-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>{round.is_blind ? 'Ballot' : 'Person'}</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {columns.map((column, index) => (
                  <td key={column}>{row.answers[index] || <span className="empty-cell">-</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSubmissionRows(
  submissions: Submission[],
  participants: RoomSnapshot['participants'],
  round: RoomRound,
  optionById: Map<string, string>,
) {
  const participantOrder = new Map(participants.map((participant, index) => [participant.id, index]));
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  return [...submissions]
    .sort((a, b) => {
      const aOrder = participantOrder.get(a.participant_id) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = participantOrder.get(b.participant_id) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.submitted_at.localeCompare(b.submitted_at);
    })
    .map((submission, index) => ({
      key: submission.participant_id,
      label: round.is_blind
        ? `Ballot ${index + 1}`
        : participantById.get(submission.participant_id)?.display_name ?? 'Guest',
      answers:
        round.mode === 'ranking'
          ? submission.answers.map((answer) => optionById.get(answer) ?? 'Unknown option')
          : submission.answers,
    }));
}

function getResultColumnCount(round: RoomRound, options: RoomOption[], submissions: Submission[]) {
  const longestSubmission = submissions.reduce((longest, submission) => Math.max(longest, submission.answers.length), 0);

  if (round.mode === 'ranking') {
    return Math.max(options.length, longestSubmission, 1);
  }

  return Math.max(round.max_answers, longestSubmission, 1);
}

function getRankingScores(options: RoomOption[], submissions: Submission[]) {
  const scores = new Map(options.map((option) => [option.id, { option, score: 0 }]));
  const optionCount = options.length;

  for (const submission of submissions) {
    submission.answers.forEach((optionId, index) => {
      const entry = scores.get(optionId);
      if (entry) entry.score += optionCount - index;
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score || a.option.sort_order - b.option.sort_order);
}

export default App;
