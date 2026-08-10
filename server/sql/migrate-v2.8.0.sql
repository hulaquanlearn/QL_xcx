USE couple_space;

-- 微信身份已从 users 迁移到 sessions。以下清理均可重复执行。
SET @user_wechat_openid_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='wechat_openid'
);
SET @drop_user_wechat_openid_sql = IF(
  @user_wechat_openid_exists=1,
  'ALTER TABLE users DROP COLUMN wechat_openid',
  'SELECT 1'
);
PREPARE drop_user_wechat_openid_stmt FROM @drop_user_wechat_openid_sql;
EXECUTE drop_user_wechat_openid_stmt;
DEALLOCATE PREPARE drop_user_wechat_openid_stmt;

SET @user_wechat_seen_at_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='wechat_seen_at'
);
SET @drop_user_wechat_seen_at_sql = IF(
  @user_wechat_seen_at_exists=1,
  'ALTER TABLE users DROP COLUMN wechat_seen_at',
  'SELECT 1'
);
PREPARE drop_user_wechat_seen_at_stmt FROM @drop_user_wechat_seen_at_sql;
EXECUTE drop_user_wechat_seen_at_stmt;
DEALLOCATE PREPARE drop_user_wechat_seen_at_stmt;

-- 头像早已迁移到 users.avatar_key，旧表不再被运行时代码读取。
DROP TABLE IF EXISTS avatars;
