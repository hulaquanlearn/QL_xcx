USE couple_space;

SET @wechat_openid_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='wechat_openid'
);
SET @add_wechat_openid_sql = IF(
  @wechat_openid_exists=0,
  'ALTER TABLE users ADD COLUMN wechat_openid VARCHAR(64) NULL AFTER avatar_key',
  'SELECT 1'
);
PREPARE add_wechat_openid_stmt FROM @add_wechat_openid_sql;
EXECUTE add_wechat_openid_stmt;
DEALLOCATE PREPARE add_wechat_openid_stmt;

SET @wechat_seen_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='wechat_seen_at'
);
SET @add_wechat_seen_sql = IF(
  @wechat_seen_exists=0,
  'ALTER TABLE users ADD COLUMN wechat_seen_at DATETIME NULL AFTER wechat_openid',
  'SELECT 1'
);
PREPARE add_wechat_seen_stmt FROM @add_wechat_seen_sql;
EXECUTE add_wechat_seen_stmt;
DEALLOCATE PREPARE add_wechat_seen_stmt;

SET @wechat_openid_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uq_users_wechat_openid'
);
SET @add_wechat_openid_index_sql = IF(
  @wechat_openid_index_exists=0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_wechat_openid (wechat_openid)',
  'SELECT 1'
);
PREPARE add_wechat_openid_index_stmt FROM @add_wechat_openid_index_sql;
EXECUTE add_wechat_openid_index_stmt;
DEALLOCATE PREPARE add_wechat_openid_index_stmt;

CREATE TABLE IF NOT EXISTS media_checks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  couple_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('avatar','album','dish') NOT NULL,
  status ENUM('pending','approved','rejected','failed','expired') NOT NULL DEFAULT 'pending',
  trace_id VARCHAR(64) NULL,
  access_token_hash CHAR(64) NOT NULL,
  pending_filename VARCHAR(64) NOT NULL,
  final_key VARCHAR(1000) NULL,
  error_code INT NULL,
  expires_at DATETIME NOT NULL,
  checked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_media_checks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_media_checks_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  UNIQUE KEY uq_media_checks_trace (trace_id),
  UNIQUE KEY uq_media_checks_access_token (access_token_hash),
  INDEX idx_media_checks_status_expiry (status,expires_at)
) ENGINE=InnoDB;
