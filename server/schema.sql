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
  reset_code_attempts INTEGER DEFAULT 0,
  -- JWTs issued before this timestamp are rejected (see authenticate() in
  -- index.js). Set on password reset so a stolen long-lived token dies.
  session_valid_after TIMESTAMP WITH TIME ZONE,
  push_token TEXT,
  -- Hat dieser Nutzer seine Schnellwahl schon einmal selbst gesetzt?
  -- Ohne diesen Merker wäre "noch nie gewählt" nicht von "bewusst geleert"
  -- zu unterscheiden — und eine geleerte Schnellwahl käme bei jedem Abruf
  -- als Standardauswahl zurück.
  quick_picks_set BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS drinks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  volume INTEGER NOT NULL,
  abv NUMERIC NOT NULL,
  calories INTEGER DEFAULT 0,
  -- Owner of a user-created drink; NULL = built-in catalog (undeletable).
  -- No FK on purpose: a deleted account must not take shared drinks (and
  -- everybody's logs referencing them) with it.
  created_by TEXT,
  -- Barcode (EAN-8/EAN-13). Filled by whoever first scans an unknown code and
  -- names the product, so the next person to scan it gets the drink directly.
  ean TEXT
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
  pending_user_ids JSONB DEFAULT '[]'::jsonb,
  -- Einladungscode für den Beitritt. NULL, solange der Admin ihn nie abgerufen
  -- hat. Der Index dazu liegt in db.js, weil die Spalte auf bestehenden
  -- Datenbanken per ALTER nachkommt (siehe Hinweis am Dateiende).
  invite_code TEXT
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
  context_type TEXT NOT NULL, -- 'group', 'event' or 'friends'
  context_id TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  -- URL im Objektspeicher (Beweisfoto). Bei Servern ohne R2 auch ein
  -- Base64-Data-URL, siehe validateImageReference in index.js.
  image TEXT
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

-- Wie weit jemand eine Unterhaltung gelesen hat.
--
-- `conversation_key` ist `dm:<andereNutzerId>` oder `group:<gruppenId>`. Ein
-- einzelnes Schlüsselfeld statt zweier nullbarer Spalten: das gibt einen
-- sauberen Primärschlüssel und erspart partielle Unique-Indizes.
--
-- Kein Fremdschlüssel auf das Ziel: eine gelöschte Gruppe hinterlässt hier
-- höchstens einen verwaisten Zeitstempel, und der wird ohnehin nie gelesen
-- (Ungelesen-Zahlen entstehen nur aus Gruppen, in denen man Mitglied ist).
--
-- Fehlt ein Eintrag, gilt die Unterhaltung als NIE gelesen — dann sind alle
-- Nachrichten darin neu. Das ist die ehrliche Bedeutung; beim ersten Start
-- nach dem Deploy stehen deshalb einmalig Zahlen an alten Unterhaltungen.
CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_key TEXT NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (user_id, conversation_key)
);

-- Persönliche Schnellwahl: welche Getränke jemand auf dem Dashboard als
-- Kachel sieht, und in welcher Reihenfolge.
--
-- Der Grund für die Trennung von `drinks`: der Katalog ist geteilt und wächst
-- durch Barcode-Scans (Community-Datenbank). Vorher war jeder Katalogeintrag
-- automatisch bei allen eine Kachel — legte jemand ein Getränk an, stand es
-- im Dashboard sämtlicher Nutzer.
CREATE TABLE IF NOT EXISTS user_drinks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drink_id TEXT NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, drink_id)
);

-- Blocking. Mutual by effect: once a block exists in either direction, the
-- two users stop seeing each other everywhere (feed, radar, map, search,
-- chat). Store requirement for apps with user-generated content.
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Reports of objectionable content or behaviour. reported_user_id survives
-- the reported account being deleted (SET NULL) so the record of the report
-- itself doesn't disappear with it.
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reported_username TEXT,
  content_type TEXT NOT NULL, -- 'user' | 'post' | 'message'
  content_id TEXT,
  content_excerpt TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
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
-- Für die Ungelesen-Zahlen. Der vorhandene idx_messages_conversation liegt auf
-- (sender_id, receiver_id) und hilft dabei nicht: gezählt wird nach Empfänger
-- UND Zeit, bzw. nach Gruppe UND Zeit.
CREATE INDEX IF NOT EXISTS idx_messages_receiver_time ON messages(receiver_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_group_time ON messages(group_id, timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_pair ON blocks(blocker_id, blocked_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, timestamp);
CREATE INDEX IF NOT EXISTS idx_user_drinks_user ON user_drinks(user_id, position);

-- ACHTUNG: Indizes auf Spalten, die per ALTER TABLE nachgerüstet werden,
-- gehören NICHT hierher, sondern in die Migrationsphase von initPgSchema()
-- (server/db.js). Diese Datei läuft als EIN Query: schlägt eine Anweisung
-- fehl, bricht alles danach mit ab — inklusive der ALTER-Zeilen, die die
-- Spalte überhaupt erst anlegen würden. Genau das ist mit drinks.ean
-- passiert: der Index stand hier, die Spalte entstand in db.js, und auf
-- bestehenden Datenbanken scheiterte deshalb die ganze Initialisierung.
-- idx_drinks_ean liegt aus diesem Grund in db.js. tests/schema.test.js
-- prüft die Regel.

