-- Turso / SQLite only. No Supabase migration, catalog mutation or fan send.
-- Existing bruff_catalog_* snapshot tables must already exist.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS bruff_fan_script_observations(
 observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 fan_id TEXT NOT NULL CHECK(length(fan_id) BETWEEN 1 AND 24 AND fan_id NOT GLOB '*[^0-9]*' AND substr(fan_id,1,1)<>'0'),
 batch_hash TEXT NOT NULL,folder_id TEXT NOT NULL,media_id TEXT NOT NULL,
 message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 24 AND message_id NOT GLOB '*[^0-9]*' AND substr(message_id,1,1)<>'0'),
 message_created_at TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('offered','free_sent','sent_price_unknown')),
 price_cents INTEGER CHECK(price_cents IS NULL OR price_cents>=0),
 opened_reported INTEGER CHECK(opened_reported IS NULL OR opened_reported IN(0,1)),
 paid_confirmed INTEGER NOT NULL CHECK(paid_confirmed=0),
 actor_id TEXT NOT NULL CHECK(length(actor_id)=36 AND actor_id=lower(actor_id) AND substr(actor_id,9,1)='-' AND substr(actor_id,14,1)='-' AND substr(actor_id,19,1)='-' AND substr(actor_id,24,1)='-' AND length(replace(actor_id,'-',''))=32 AND replace(actor_id,'-','') NOT GLOB '*[^0-9a-f]*'),
 observation_hash TEXT NOT NULL CHECK(length(observation_hash)=64 AND observation_hash NOT GLOB '*[^0-9a-f]*'),
 observed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='offered' AND price_cents IS NOT NULL AND price_cents>0) OR (kind='free_sent' AND price_cents IS NOT NULL AND price_cents=0) OR (kind='sent_price_unknown' AND price_cents IS NULL)),
 UNIQUE(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,observation_hash),
 FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id,folder_id,media_id) REFERENCES bruff_catalog_media(owner_id,workspace_id,batch_hash,creator_id,folder_key,media_id)
) STRICT;
CREATE INDEX IF NOT EXISTS bruff_fan_script_observations_scope ON bruff_fan_script_observations(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,observation_id);
CREATE TRIGGER IF NOT EXISTS bruff_fan_script_observations_no_update BEFORE UPDATE ON bruff_fan_script_observations BEGIN SELECT RAISE(ABORT,'Observations are append-only');END;
CREATE TRIGGER IF NOT EXISTS bruff_fan_script_observations_no_delete BEFORE DELETE ON bruff_fan_script_observations BEGIN SELECT RAISE(ABORT,'Observations are append-only');END;
CREATE TABLE IF NOT EXISTS bruff_fan_script_scans(
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 fan_id TEXT NOT NULL CHECK(length(fan_id) BETWEEN 1 AND 24 AND fan_id NOT GLOB '*[^0-9]*' AND substr(fan_id,1,1)<>'0'),
 batch_hash TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),cursor TEXT CHECK(cursor IS NULL OR length(cursor) BETWEEN 1 AND 2048),
 history_complete INTEGER NOT NULL CHECK(history_complete IN(0,1)),recent_checked_at TEXT,history_checked_at TEXT,pages INTEGER NOT NULL CHECK(pages BETWEEN 0 AND 1000000),
 actor_id TEXT NOT NULL CHECK(length(actor_id)=36 AND actor_id=lower(actor_id) AND substr(actor_id,9,1)='-' AND substr(actor_id,14,1)='-' AND substr(actor_id,19,1)='-' AND substr(actor_id,24,1)='-' AND length(replace(actor_id,'-',''))=32 AND replace(actor_id,'-','') NOT GLOB '*[^0-9a-f]*'),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(history_complete=0 OR (cursor IS NULL AND history_checked_at IS NOT NULL)),
 PRIMARY KEY(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash),
 FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id) REFERENCES bruff_catalog_models(owner_id,workspace_id,batch_hash,creator_id)
) STRICT;
COMMIT;
