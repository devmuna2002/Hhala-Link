-- 002: Widen avatar columns from TEXT to MEDIUMTEXT on MySQL/MariaDB.
--
-- Why: MySQL TEXT tops out at 65,535 bytes. A single phone photo embedded as
-- a base64 data URI is routinely 100KB+, so one oversized avatar_url aborted
-- the entire profile UPDATE with ER_DATA_TOO_LONG ("Data too long for column
-- 'avatar_url'"). The API now rejects data URIs outright and the app uploads
-- photos to storage first, but this removes the cliff edge for any other
-- long-but-legitimate value.
--
-- Safe to re-run: MODIFY COLUMN is idempotent.
-- Run on the cPanel MySQL database (phpMyAdmin SQL tab, or):
--   mysql -h <host> -u <user> -p <database> < 002_avatar_url_mediumtext.sql

ALTER TABLE profiles MODIFY COLUMN avatar_url MEDIUMTEXT NULL;
ALTER TABLE movers MODIFY COLUMN avatar_url MEDIUMTEXT NULL;
ALTER TABLE movers MODIFY COLUMN logo_url MEDIUMTEXT NULL;
