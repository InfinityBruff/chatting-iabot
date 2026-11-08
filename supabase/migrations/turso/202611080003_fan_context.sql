-- Turso/SQLite. Neutral cited context, separate from catalog and payment events.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS bruff_fan_context_current(
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 fan_id TEXT NOT NULL CHECK(length(fan_id) BETWEEN 1 AND 24 AND fan_id NOT GLOB '*[^0-9]*' AND substr(fan_id,1,1)<>'0'),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 memory_json TEXT NOT NULL CHECK(json_valid(memory_json) AND json_type(memory_json)='object' AND length(memory_json)<=1048576 AND json_extract(memory_json,'$.version')=version),
 scan_json TEXT NOT NULL CHECK(json_valid(scan_json) AND json_type(scan_json)='object' AND length(scan_json)<=1048576),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
 actor_id TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(owner_id,workspace_id,creator_id,binding,fan_id)
) STRICT;
COMMIT;
