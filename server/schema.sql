-- SQL Schema for TrinkDuell
-- For deployment on PostgreSQL (e.g. Proxmox Homeserver Container)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  title TEXT,
  rank TEXT,
  points INTEGER DEFAULT 0,
  alcohol_grams NUMERIC DEFAULT 0.0,
  achievements JSONB DEFAULT '[]'::jsonb,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  selected_title TEXT,
  level INTEGER DEFAULT 1,
  active_quest TEXT,
  reset_code TEXT,
  reset_code_expires_at TIMESTAMP WITH TIME ZONE,
  push_token TEXT
);

CREATE TABLE IF NOT EXISTS drinks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  volume INTEGER NOT NULL,
  abv NUMERIC NOT NULL,
  calories INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drink_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drink_id TEXT NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  latitude NUMERIC,
  longitude NUMERIC
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_ids JSONB DEFAULT '[]'::jsonb,
  pending_user_ids JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL,
  member_ids JSONB DEFAULT '[]'::jsonb,
  end_timestamp TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  context_type TEXT NOT NULL, -- 'group' or 'event'
  context_id TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration INTEGER NOT NULL, -- duration in minutes
  status TEXT NOT NULL, -- 'pending', 'active', 'finished'
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  creator_points INTEGER DEFAULT 0,
  opponent_points INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS group_quests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL, -- 'volume', 'water', 'drinks'
  target_value NUMERIC NOT NULL,
  current_value NUMERIC DEFAULT 0.0,
  status TEXT NOT NULL, -- 'active', 'completed', 'failed'
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  sender_username TEXT NOT NULL,
  receiver_username TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_drink_logs_user_id ON drink_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_context ON posts(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_duels_players ON duels(creator_id, opponent_id);
CREATE INDEX IF NOT EXISTS idx_group_quests ON group_quests(group_id);
CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(sender_username, receiver_username);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);

