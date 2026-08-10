USE couple_space;

SET @session_wechat_openid_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sessions' AND COLUMN_NAME='wechat_openid'
);
SET @add_session_wechat_openid_sql = IF(
  @session_wechat_openid_exists=0,
  'ALTER TABLE sessions ADD COLUMN wechat_openid VARCHAR(64) NULL AFTER token_hash',
  'SELECT 1'
);
PREPARE add_session_wechat_openid_stmt FROM @add_session_wechat_openid_sql;
EXECUTE add_session_wechat_openid_stmt;
DEALLOCATE PREPARE add_session_wechat_openid_stmt;

SET @session_wechat_seen_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sessions' AND COLUMN_NAME='wechat_seen_at'
);
SET @add_session_wechat_seen_sql = IF(
  @session_wechat_seen_exists=0,
  'ALTER TABLE sessions ADD COLUMN wechat_seen_at DATETIME NULL AFTER wechat_openid',
  'SELECT 1'
);
PREPARE add_session_wechat_seen_stmt FROM @add_session_wechat_seen_sql;
EXECUTE add_session_wechat_seen_stmt;
DEALLOCATE PREPARE add_session_wechat_seen_stmt;

SET @session_wechat_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sessions' AND INDEX_NAME='idx_sessions_wechat_seen'
);
SET @add_session_wechat_index_sql = IF(
  @session_wechat_index_exists=0,
  'ALTER TABLE sessions ADD INDEX idx_sessions_wechat_seen (user_id,wechat_seen_at)',
  'SELECT 1'
);
PREPARE add_session_wechat_index_stmt FROM @add_session_wechat_index_sql;
EXECUTE add_session_wechat_index_stmt;
DEALLOCATE PREPARE add_session_wechat_index_stmt;

UPDATE sessions s
JOIN users u ON u.id=s.user_id
SET
  s.wechat_openid=COALESCE(s.wechat_openid,u.wechat_openid),
  s.wechat_seen_at=COALESCE(s.wechat_seen_at,u.wechat_seen_at)
WHERE u.wechat_openid IS NOT NULL;

SET @legacy_unique_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uq_users_wechat_openid'
);
SET @drop_legacy_unique_index_sql = IF(
  @legacy_unique_index_exists>0,
  'ALTER TABLE users DROP INDEX uq_users_wechat_openid',
  'SELECT 1'
);
PREPARE drop_legacy_unique_index_stmt FROM @drop_legacy_unique_index_sql;
EXECUTE drop_legacy_unique_index_stmt;
DEALLOCATE PREPARE drop_legacy_unique_index_stmt;
