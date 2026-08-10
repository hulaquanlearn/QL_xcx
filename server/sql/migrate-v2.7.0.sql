USE couple_space;

ALTER TABLE orders
  MODIFY COLUMN status ENUM('pending','accepted','ready','completed') NOT NULL DEFAULT 'pending';

ALTER TABLE media_checks
  MODIFY COLUMN purpose ENUM('avatar','album','dish','recipe') NOT NULL;

SET @ready_at_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='ready_at'
);
SET @add_ready_at_sql = IF(
  @ready_at_exists=0,
  'ALTER TABLE orders ADD COLUMN ready_at DATETIME NULL AFTER accepted_at',
  'SELECT 1'
);
PREPARE add_ready_at_stmt FROM @add_ready_at_sql;
EXECUTE add_ready_at_stmt;
DEALLOCATE PREPARE add_ready_at_stmt;
