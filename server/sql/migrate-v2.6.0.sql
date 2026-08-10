USE couple_space;

SET @accepted_user_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='accepted_by_user_id'
);
SET @add_accepted_user_sql = IF(
  @accepted_user_exists=0,
  'ALTER TABLE orders ADD COLUMN accepted_by_user_id BIGINT UNSIGNED NULL AFTER accepted_by',
  'SELECT 1'
);
PREPARE add_accepted_user_stmt FROM @add_accepted_user_sql;
EXECUTE add_accepted_user_stmt;
DEALLOCATE PREPARE add_accepted_user_stmt;

UPDATE orders o
JOIN users receiver
  ON receiver.couple_id=o.couple_id
 AND receiver.id<>o.author_id
SET o.accepted_by_user_id=receiver.id
WHERE o.status IN ('accepted','completed')
  AND o.accepted_by_user_id IS NULL;

SET @accepted_user_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_accepted_by'
);
SET @add_accepted_user_index_sql = IF(
  @accepted_user_index_exists=0,
  'ALTER TABLE orders ADD INDEX idx_orders_accepted_by (accepted_by_user_id,status)',
  'SELECT 1'
);
PREPARE add_accepted_user_index_stmt FROM @add_accepted_user_index_sql;
EXECUTE add_accepted_user_index_stmt;
DEALLOCATE PREPARE add_accepted_user_index_stmt;

SET @accepted_user_fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='orders'
    AND CONSTRAINT_NAME='fk_orders_accepted_by_user'
    AND CONSTRAINT_TYPE='FOREIGN KEY'
);
SET @add_accepted_user_fk_sql = IF(
  @accepted_user_fk_exists=0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_accepted_by_user FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_accepted_user_fk_stmt FROM @add_accepted_user_fk_sql;
EXECUTE add_accepted_user_fk_stmt;
DEALLOCATE PREPARE add_accepted_user_fk_stmt;
