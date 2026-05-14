create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'room_mode') then
    create type public.room_mode as enum ('free_text', 'ranking');
  end if;
end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z2-9]{4,8}$'),
  title text not null default 'Untitled room' check (char_length(title) between 1 and 80),
  mode public.room_mode not null default 'free_text',
  is_blind boolean not null default false,
  max_answers integer not null default 1 check (max_answers between 1 and 5),
  revealed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.room_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  title text not null default 'Round 1' check (char_length(title) between 1 and 80),
  mode public.room_mode not null default 'free_text',
  is_blind boolean not null default false,
  max_answers integer not null default 1 check (max_answers between 1 and 5),
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, round_number)
);

create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  host_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_options (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid references public.room_rounds(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (room_id, sort_order)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.participant_secrets (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  participant_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.submission_status (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid references public.room_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  answer_count integer not null check (answer_count between 1 and 50),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

create table if not exists public.submissions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid references public.room_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

alter table public.room_options add column if not exists round_id uuid references public.room_rounds(id) on delete cascade;
alter table public.submission_status add column if not exists round_id uuid references public.room_rounds(id) on delete cascade;
alter table public.submissions add column if not exists round_id uuid references public.room_rounds(id) on delete cascade;

create index if not exists idx_rooms_code on public.rooms(code);
create index if not exists idx_room_rounds_room_id on public.room_rounds(room_id);
create index if not exists idx_room_options_room_id on public.room_options(room_id);
create index if not exists idx_room_options_round_id on public.room_options(round_id);
create index if not exists idx_participants_room_id on public.participants(room_id);
create index if not exists idx_submission_status_room_id on public.submission_status(room_id);
create index if not exists idx_submission_status_round_id on public.submission_status(round_id);
create index if not exists idx_submissions_room_id on public.submissions(room_id);
create index if not exists idx_submissions_round_id on public.submissions(round_id);

insert into public.room_rounds (room_id, round_number, title, mode, is_blind, max_answers, revealed_at, created_at)
select r.id, 1, r.title, r.mode, r.is_blind, r.max_answers, r.revealed_at, r.created_at
from public.rooms r
where not exists (
  select 1
  from public.room_rounds rr
  where rr.room_id = r.id
);

update public.room_options ro
set round_id = rr.id
from public.room_rounds rr
where ro.round_id is null
  and ro.room_id = rr.room_id
  and rr.round_number = 1;

update public.submission_status ss
set round_id = rr.id
from public.room_rounds rr
where ss.round_id is null
  and ss.room_id = rr.room_id
  and rr.round_number = 1;

update public.submissions s
set round_id = rr.id
from public.room_rounds rr
where s.round_id is null
  and s.room_id = rr.room_id
  and rr.round_number = 1;

alter table public.room_options alter column round_id set not null;
alter table public.submission_status alter column round_id set not null;
alter table public.submissions alter column round_id set not null;

alter table public.room_options drop constraint if exists room_options_room_id_sort_order_key;
alter table public.room_options drop constraint if exists room_options_round_id_sort_order_key;
alter table public.room_options add constraint room_options_round_id_sort_order_key unique (round_id, sort_order);

alter table public.submission_status drop constraint if exists submission_status_pkey;
alter table public.submission_status add constraint submission_status_pkey primary key (round_id, participant_id);

alter table public.submissions drop constraint if exists submissions_pkey;
alter table public.submissions add constraint submissions_pkey primary key (round_id, participant_id);

create or replace function public.normalize_room_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.random_room_code(p_length integer default 5)
returns text
language plpgsql
volatile
as $$
declare
  v_chars constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_result text := '';
  v_i integer;
begin
  for v_i in 1..greatest(4, least(coalesce(p_length, 5), 8)) loop
    v_result := v_result || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
  end loop;

  return v_result;
end;
$$;

create or replace function public.secure_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
$$;

create or replace function public.create_room(
  p_title text default 'Untitled room',
  p_mode public.room_mode default 'free_text',
  p_is_blind boolean default false,
  p_max_answers integer default 1,
  p_options text[] default array[]::text[]
)
returns table (
  room_id uuid,
  room_code text,
  host_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room_id uuid;
  v_round_id uuid;
  v_code text;
  v_host_token text := public.secure_token();
  v_clean_title text := nullif(left(trim(coalesce(p_title, '')), 80), '');
  v_clean_options text[];
begin
  if coalesce(p_mode, 'free_text') = 'free_text' and (coalesce(p_max_answers, 1) < 1 or coalesce(p_max_answers, 1) > 5) then
    raise exception 'max_answers must be between 1 and 5';
  end if;

  if coalesce(p_mode, 'free_text') = 'ranking' then
    select coalesce(array_agg(label order by ordinality), array[]::text[])
    into v_clean_options
    from (
      select distinct on (lower(trim(option_label)))
        left(trim(option_label), 80) as label,
        ordinality
      from unnest(coalesce(p_options, array[]::text[])) with ordinality as t(option_label, ordinality)
      where trim(option_label) <> ''
      order by lower(trim(option_label)), ordinality
    ) cleaned;

    if coalesce(array_length(v_clean_options, 1), 0) < 2 then
      raise exception 'ranking rooms need at least 2 options';
    end if;
  end if;

  loop
    v_code := public.random_room_code(5);
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;

  insert into public.rooms (code, title, mode, is_blind, max_answers)
  values (
    v_code,
    coalesce(v_clean_title, 'Untitled room'),
    coalesce(p_mode, 'free_text'),
    coalesce(p_is_blind, false),
    case when coalesce(p_mode, 'free_text') = 'ranking' then 1 else coalesce(p_max_answers, 1) end
  )
  returning id into v_room_id;

  insert into public.room_secrets (room_id, host_token_hash)
  values (v_room_id, extensions.crypt(v_host_token, extensions.gen_salt('bf', 8)));

  insert into public.room_rounds (room_id, round_number, title, mode, is_blind, max_answers)
  values (
    v_room_id,
    1,
    coalesce(v_clean_title, 'Untitled room'),
    coalesce(p_mode, 'free_text'),
    coalesce(p_is_blind, false),
    case when coalesce(p_mode, 'free_text') = 'ranking' then 1 else coalesce(p_max_answers, 1) end
  )
  returning id into v_round_id;

  if coalesce(p_mode, 'free_text') = 'ranking' then
    insert into public.room_options (room_id, round_id, label, sort_order)
    select v_room_id, v_round_id, option_label, ordinality
    from unnest(v_clean_options) with ordinality as t(option_label, ordinality);
  end if;

  room_id := v_room_id;
  room_code := v_code;
  host_token := v_host_token;
  return next;
end;
$$;

create or replace function public.join_room(
  p_room_code text,
  p_display_name text
)
returns table (
  participant_id uuid,
  participant_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_token text := public.secure_token();
  v_name text := nullif(left(trim(coalesce(p_display_name, '')), 40), '');
begin
  select id into v_room_id
  from public.rooms
  where code = public.normalize_room_code(p_room_code);

  if v_room_id is null then
    raise exception 'room not found';
  end if;

  insert into public.participants (room_id, display_name)
  values (v_room_id, coalesce(v_name, 'Guest ' || substr(public.secure_token(), 1, 4)))
  returning id into v_participant_id;

  insert into public.participant_secrets (participant_id, participant_token_hash)
  values (v_participant_id, extensions.crypt(v_token, extensions.gen_salt('bf', 8)));

  participant_id := v_participant_id;
  participant_token := v_token;
  return next;
end;
$$;

create or replace function public.save_submission(
  p_room_code text,
  p_participant_id uuid,
  p_participant_token text,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room public.rooms%rowtype;
  v_round public.room_rounds%rowtype;
  v_token_hash text;
  v_answer_count integer;
  v_option_count integer;
begin
  select * into v_room
  from public.rooms
  where code = public.normalize_room_code(p_room_code);

  if v_room.id is null then
    raise exception 'room not found';
  end if;

  select * into v_round
  from public.room_rounds
  where room_id = v_room.id
  order by round_number desc
  limit 1;

  if v_round.id is null then
    raise exception 'room has no active round';
  end if;

  if v_round.revealed_at is not null then
    raise exception 'this room has already been revealed';
  end if;

  select ps.participant_token_hash
  into v_token_hash
  from public.participant_secrets ps
  join public.participants p on p.id = ps.participant_id
  where p.id = p_participant_id
    and p.room_id = v_room.id;

  if v_token_hash is null or extensions.crypt(coalesce(p_participant_token, ''), v_token_hash) <> v_token_hash then
    raise exception 'participant token is invalid';
  end if;

  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'answers must be an array';
  end if;

  v_answer_count := jsonb_array_length(p_answers);

  if v_answer_count < 1 then
    raise exception 'at least one answer is required';
  end if;

  if v_round.mode = 'free_text' then
    if v_answer_count > v_round.max_answers then
      raise exception 'too many answers';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(p_answers) as answer(value)
      where length(trim(value)) = 0 or char_length(value) > 160
    ) then
      raise exception 'answers must be 1 to 160 characters';
    end if;
  end if;

  if v_round.mode = 'ranking' then
    select count(*) into v_option_count
    from public.room_options
    where round_id = v_round.id;

    if v_answer_count <> v_option_count then
      raise exception 'ranking submissions must include every option exactly once';
    end if;

    if (
      select count(distinct value)
      from jsonb_array_elements_text(p_answers) as selected(value)
    ) <> v_option_count then
      raise exception 'ranking submissions must not contain duplicates';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(p_answers) as selected(value)
      where not exists (
        select 1
        from public.room_options ro
        where ro.round_id = v_round.id
          and ro.id::text = selected.value
      )
    ) then
      raise exception 'ranking submission contains an unknown option';
    end if;
  end if;

  insert into public.submissions (room_id, round_id, participant_id, answers, submitted_at, updated_at)
  values (v_room.id, v_round.id, p_participant_id, p_answers, now(), now())
  on conflict (round_id, participant_id)
  do update set answers = excluded.answers, updated_at = now();

  insert into public.submission_status (room_id, round_id, participant_id, answer_count, submitted_at, updated_at)
  values (v_room.id, v_round.id, p_participant_id, v_answer_count, now(), now())
  on conflict (round_id, participant_id)
  do update set answer_count = excluded.answer_count, updated_at = now();

  update public.participants
  set last_seen_at = now()
  where id = p_participant_id;
end;
$$;

create or replace function public.reveal_room(
  p_room_code text,
  p_host_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room_id uuid;
  v_round_id uuid;
  v_token_hash text;
begin
  select r.id, rs.host_token_hash
  into v_room_id, v_token_hash
  from public.rooms r
  join public.room_secrets rs on rs.room_id = r.id
  where r.code = public.normalize_room_code(p_room_code);

  if v_room_id is null then
    raise exception 'room not found';
  end if;

  if v_token_hash is null or extensions.crypt(coalesce(p_host_token, ''), v_token_hash) <> v_token_hash then
    raise exception 'host token is invalid';
  end if;

  select id into v_round_id
  from public.room_rounds
  where room_id = v_room_id
  order by round_number desc
  limit 1;

  if v_round_id is null then
    raise exception 'room has no active round';
  end if;

  update public.room_rounds
  set revealed_at = coalesce(revealed_at, now())
  where id = v_round_id;

  update public.rooms
  set revealed_at = coalesce(revealed_at, now())
  where id = v_room_id;

  return true;
end;
$$;

create or replace function public.start_next_round(
  p_room_code text,
  p_host_token text,
  p_title text default 'Next round',
  p_mode public.room_mode default 'free_text',
  p_is_blind boolean default false,
  p_max_answers integer default 1,
  p_options text[] default array[]::text[]
)
returns table (
  round_id uuid,
  round_number integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room_id uuid;
  v_token_hash text;
  v_latest_round public.room_rounds%rowtype;
  v_round_id uuid;
  v_round_number integer;
  v_clean_title text := nullif(left(trim(coalesce(p_title, '')), 80), '');
  v_clean_options text[];
begin
  select r.id, rs.host_token_hash
  into v_room_id, v_token_hash
  from public.rooms r
  join public.room_secrets rs on rs.room_id = r.id
  where r.code = public.normalize_room_code(p_room_code);

  if v_room_id is null then
    raise exception 'room not found';
  end if;

  if v_token_hash is null or extensions.crypt(coalesce(p_host_token, ''), v_token_hash) <> v_token_hash then
    raise exception 'host token is invalid';
  end if;

  select * into v_latest_round
  from public.room_rounds
  where room_id = v_room_id
  order by round_number desc
  limit 1;

  if v_latest_round.id is null then
    raise exception 'room has no active round';
  end if;

  if v_latest_round.revealed_at is null then
    raise exception 'reveal the current round before starting a new one';
  end if;

  if coalesce(p_mode, 'free_text') = 'free_text' and (coalesce(p_max_answers, 1) < 1 or coalesce(p_max_answers, 1) > 5) then
    raise exception 'max_answers must be between 1 and 5';
  end if;

  if coalesce(p_mode, 'free_text') = 'ranking' then
    select coalesce(array_agg(label order by ordinality), array[]::text[])
    into v_clean_options
    from (
      select distinct on (lower(trim(option_label)))
        left(trim(option_label), 80) as label,
        ordinality
      from unnest(coalesce(p_options, array[]::text[])) with ordinality as t(option_label, ordinality)
      where trim(option_label) <> ''
      order by lower(trim(option_label)), ordinality
    ) cleaned;

    if coalesce(array_length(v_clean_options, 1), 0) < 2 then
      raise exception 'ranking rounds need at least 2 options';
    end if;
  end if;

  v_round_number := v_latest_round.round_number + 1;

  insert into public.room_rounds (room_id, round_number, title, mode, is_blind, max_answers)
  values (
    v_room_id,
    v_round_number,
    coalesce(v_clean_title, 'Round ' || v_round_number),
    coalesce(p_mode, 'free_text'),
    coalesce(p_is_blind, false),
    case when coalesce(p_mode, 'free_text') = 'ranking' then 1 else coalesce(p_max_answers, 1) end
  )
  returning id into v_round_id;

  update public.rooms
  set mode = coalesce(p_mode, 'free_text'),
      is_blind = coalesce(p_is_blind, false),
      max_answers = case when coalesce(p_mode, 'free_text') = 'ranking' then 1 else coalesce(p_max_answers, 1) end,
      revealed_at = null
  where id = v_room_id;

  if coalesce(p_mode, 'free_text') = 'ranking' then
    insert into public.room_options (room_id, round_id, label, sort_order)
    select v_room_id, v_round_id, option_label, ordinality
    from unnest(v_clean_options) with ordinality as t(option_label, ordinality);
  end if;

  round_id := v_round_id;
  round_number := v_round_number;
  return next;
end;
$$;

create or replace function public.is_room_host(
  p_room_code text,
  p_host_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
begin
  select rs.host_token_hash
  into v_token_hash
  from public.rooms r
  join public.room_secrets rs on rs.room_id = r.id
  where r.code = public.normalize_room_code(p_room_code);

  return v_token_hash is not null and extensions.crypt(coalesce(p_host_token, ''), v_token_hash) = v_token_hash;
end;
$$;

alter table public.rooms enable row level security;
alter table public.room_rounds enable row level security;
alter table public.room_secrets enable row level security;
alter table public.room_options enable row level security;
alter table public.participants enable row level security;
alter table public.participant_secrets enable row level security;
alter table public.submission_status enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "rooms are readable by everyone" on public.rooms;
create policy "rooms are readable by everyone"
on public.rooms
for select
using (true);

drop policy if exists "room rounds are readable by everyone" on public.room_rounds;
create policy "room rounds are readable by everyone"
on public.room_rounds
for select
using (true);

drop policy if exists "room options are readable by everyone" on public.room_options;
create policy "room options are readable by everyone"
on public.room_options
for select
using (true);

drop policy if exists "participants are readable by everyone" on public.participants;
create policy "participants are readable by everyone"
on public.participants
for select
using (true);

drop policy if exists "submission status is readable by everyone" on public.submission_status;
create policy "submission status is readable by everyone"
on public.submission_status
for select
using (true);

drop policy if exists "submissions are readable after reveal" on public.submissions;
create policy "submissions are readable after reveal"
on public.submissions
for select
using (
  exists (
    select 1
    from public.room_rounds rr
    where rr.id = submissions.round_id
      and rr.revealed_at is not null
  )
);

revoke all on public.room_secrets from anon, authenticated;
revoke all on public.participant_secrets from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.rooms to anon, authenticated;
grant select on public.room_rounds to anon, authenticated;
grant select on public.room_options to anon, authenticated;
grant select on public.participants to anon, authenticated;
grant select on public.submission_status to anon, authenticated;
grant select on public.submissions to anon, authenticated;
grant execute on function public.create_room(text, public.room_mode, boolean, integer, text[]) to anon, authenticated;
grant execute on function public.join_room(text, text) to anon, authenticated;
grant execute on function public.save_submission(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.reveal_room(text, text) to anon, authenticated;
grant execute on function public.start_next_round(text, text, text, public.room_mode, boolean, integer, text[]) to anon, authenticated;
grant execute on function public.is_room_host(text, text) to anon, authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.rooms;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.room_rounds;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.room_options;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.participants;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.submission_status;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.submissions;
  exception when duplicate_object then null;
  end;
end $$;
