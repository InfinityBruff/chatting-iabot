-- Turso / SQLite only. These append-only records do not send content or mutate
-- the imported catalogue or the earlier unpaid observation/scan contracts.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS bruff_script_plans(
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 batch_hash TEXT NOT NULL,folder_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
 approved_by TEXT NOT NULL CHECK(length(approved_by)=36 AND approved_by=lower(approved_by) AND length(replace(approved_by,'-',''))=32 AND replace(approved_by,'-','') NOT GLOB '*[^0-9a-f]*'),
 approved_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 steps_json TEXT NOT NULL CHECK(json_valid(steps_json) AND json_type(steps_json)='array' AND json_array_length(steps_json) BETWEEN 1 AND 1000),
 PRIMARY KEY(owner_id,workspace_id,creator_id,binding,batch_hash,folder_id,version),
 FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id,folder_id) REFERENCES bruff_catalog_folders(owner_id,workspace_id,batch_hash,creator_id,folder_key)
) STRICT;
CREATE TRIGGER IF NOT EXISTS bruff_script_plans_validate BEFORE INSERT ON bruff_script_plans BEGIN
 SELECT CASE WHEN json_array_length(NEW.steps_json)<>(SELECT count(*) FROM bruff_catalog_media WHERE owner_id=NEW.owner_id AND workspace_id=NEW.workspace_id AND creator_id=NEW.creator_id AND batch_hash=NEW.batch_hash AND folder_key=NEW.folder_id)
 OR (SELECT count(DISTINCT json_extract(value,'$.mediaId')) FROM json_each(NEW.steps_json))<>json_array_length(NEW.steps_json)
 OR EXISTS(SELECT 1 FROM json_each(NEW.steps_json) step LEFT JOIN bruff_catalog_media media ON media.owner_id=NEW.owner_id AND media.workspace_id=NEW.workspace_id AND media.creator_id=NEW.creator_id AND media.batch_hash=NEW.batch_hash AND media.folder_key=NEW.folder_id AND media.media_id=json_extract(step.value,'$.mediaId')
 WHERE json_type(step.value)<>'object' OR (SELECT count(*) FROM json_each(step.value))<>2 OR json_type(step.value,'$.mediaId') IS NOT 'text' OR json_type(step.value,'$.priceCents') IS NULL OR json_type(step.value,'$.priceCents') NOT IN('integer','null') OR json_extract(step.value,'$.priceCents')<0 OR media.media_id IS NULL OR (media.media_type='photo' AND json_extract(step.value,'$.priceCents') IS NOT 0))
 THEN RAISE(ABORT,'Invalid complete script plan') END;
END;
CREATE TRIGGER IF NOT EXISTS bruff_script_plans_no_update BEFORE UPDATE ON bruff_script_plans BEGIN SELECT RAISE(ABORT,'Plans are append-only');END;
CREATE TRIGGER IF NOT EXISTS bruff_script_plans_no_delete BEFORE DELETE ON bruff_script_plans BEGIN SELECT RAISE(ABORT,'Plans are append-only');END;

-- Events precede their optional catalogue association and are independent of a
-- batch. The authenticated receiver derives their one owner/model/binding.
CREATE TABLE IF NOT EXISTS bruff_ppv_events(
 event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 event_id TEXT NOT NULL CHECK(length(event_id)=36 AND event_id=lower(event_id) AND length(replace(event_id,'-',''))=32 AND replace(event_id,'-','') NOT GLOB '*[^0-9a-f]*'),
 fan_id TEXT NOT NULL CHECK(length(fan_id) BETWEEN 1 AND 24 AND fan_id NOT GLOB '*[^0-9]*' AND substr(fan_id,1,1)<>'0'),
 message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 24 AND message_id NOT GLOB '*[^0-9]*' AND substr(message_id,1,1)<>'0'),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),occurred_at TEXT NOT NULL,ingested_at TEXT NOT NULL,
 provider_contract TEXT NOT NULL CHECK(provider_contract='ofmapi-webhooks-20261107-ppv-purchased'),
 event_hash TEXT NOT NULL CHECK(length(event_hash)=64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
 actor_id TEXT NOT NULL,observed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(owner_id,workspace_id,creator_id,binding,event_id)
) STRICT;
CREATE INDEX IF NOT EXISTS bruff_ppv_events_fan ON bruff_ppv_events(owner_id,workspace_id,creator_id,binding,fan_id,event_sequence);
CREATE TRIGGER IF NOT EXISTS bruff_ppv_events_contradiction BEFORE INSERT ON bruff_ppv_events BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM bruff_ppv_events WHERE owner_id=NEW.owner_id AND workspace_id=NEW.workspace_id AND creator_id=NEW.creator_id AND binding=NEW.binding AND event_id=NEW.event_id AND (event_hash<>NEW.event_hash OR fan_id<>NEW.fan_id OR message_id<>NEW.message_id OR amount_cents<>NEW.amount_cents OR occurred_at<>NEW.occurred_at OR ingested_at<>NEW.ingested_at OR provider_contract<>NEW.provider_contract)) THEN RAISE(ABORT,'Contradictory purchase event') END;
END;
CREATE TRIGGER IF NOT EXISTS bruff_ppv_events_no_update BEFORE UPDATE ON bruff_ppv_events BEGIN SELECT RAISE(ABORT,'Events are append-only');END;
CREATE TRIGGER IF NOT EXISTS bruff_ppv_events_no_delete BEFORE DELETE ON bruff_ppv_events BEGIN SELECT RAISE(ABORT,'Events are append-only');END;

CREATE TABLE IF NOT EXISTS bruff_purchase_evidence(
 evidence_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,creator_id TEXT NOT NULL,
 binding TEXT NOT NULL CHECK(length(binding) BETWEEN 6 AND 128 AND substr(binding,1,5)='acct_' AND substr(binding,6) NOT GLOB '*[^A-Za-z0-9_-]*'),
 batch_hash TEXT NOT NULL,
 fan_id TEXT NOT NULL CHECK(length(fan_id) BETWEEN 1 AND 24 AND fan_id NOT GLOB '*[^0-9]*' AND substr(fan_id,1,1)<>'0'),
 evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^0-9a-f]*'),
 kind TEXT NOT NULL CHECK(kind IN('paid_unlock_reported','ppv_purchase_event')),
 message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 24 AND message_id NOT GLOB '*[^0-9]*' AND substr(message_id,1,1)<>'0'),
 media_ids_json TEXT NOT NULL CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json) BETWEEN 1 AND 1000),
 offer_price_cents INTEGER CHECK(offer_price_cents IS NULL OR offer_price_cents>0),
 paid_amount_cents INTEGER CHECK(paid_amount_cents IS NULL OR paid_amount_cents>0),paid_at TEXT,event_id TEXT,
 provider_contract TEXT NOT NULL,actor_id TEXT NOT NULL,
 observed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='paid_unlock_reported' AND offer_price_cents IS NOT NULL AND paid_amount_cents IS NULL AND paid_at IS NULL AND event_id IS NULL AND provider_contract='ofmapi-openapi-20261107-ppv-opened') OR (kind='ppv_purchase_event' AND paid_amount_cents IS NOT NULL AND paid_at IS NOT NULL AND event_id IS NOT NULL AND provider_contract='ofmapi-webhooks-20261107-ppv-purchased')),
 UNIQUE(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,evidence_hash),
 FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id) REFERENCES bruff_catalog_models(owner_id,workspace_id,batch_hash,creator_id),
 FOREIGN KEY(owner_id,workspace_id,creator_id,binding,event_id) REFERENCES bruff_ppv_events(owner_id,workspace_id,creator_id,binding,event_id)
) STRICT;
CREATE INDEX IF NOT EXISTS bruff_purchase_evidence_fan ON bruff_purchase_evidence(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,evidence_sequence);
CREATE TRIGGER IF NOT EXISTS bruff_purchase_evidence_validate BEFORE INSERT ON bruff_purchase_evidence BEGIN
 SELECT CASE WHEN (SELECT count(DISTINCT value) FROM json_each(NEW.media_ids_json))<>json_array_length(NEW.media_ids_json) OR EXISTS(SELECT 1 FROM json_each(NEW.media_ids_json) item WHERE item.type<>'text' OR (SELECT count(*) FROM bruff_catalog_media media WHERE media.owner_id=NEW.owner_id AND media.workspace_id=NEW.workspace_id AND media.creator_id=NEW.creator_id AND media.batch_hash=NEW.batch_hash AND media.media_id=item.value)<>1) THEN RAISE(ABORT,'Invalid evidence catalogue association') END;
 SELECT CASE WHEN NEW.kind='ppv_purchase_event' AND NOT EXISTS(SELECT 1 FROM bruff_ppv_events WHERE owner_id=NEW.owner_id AND workspace_id=NEW.workspace_id AND creator_id=NEW.creator_id AND binding=NEW.binding AND event_id=NEW.event_id AND fan_id=NEW.fan_id AND message_id=NEW.message_id AND amount_cents=NEW.paid_amount_cents AND occurred_at=NEW.paid_at AND provider_contract=NEW.provider_contract) THEN RAISE(ABORT,'Unmatched purchase event') END;
END;
CREATE TRIGGER IF NOT EXISTS bruff_purchase_evidence_no_update BEFORE UPDATE ON bruff_purchase_evidence BEGIN SELECT RAISE(ABORT,'Evidence is append-only');END;
CREATE TRIGGER IF NOT EXISTS bruff_purchase_evidence_no_delete BEFORE DELETE ON bruff_purchase_evidence BEGIN SELECT RAISE(ABORT,'Evidence is append-only');END;
COMMIT;
