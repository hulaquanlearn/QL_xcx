USE couple_space;

SET @task_id_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'albums'
    AND COLUMN_NAME = 'task_id'
);

SET @add_task_id_sql = IF(
  @task_id_exists = 0,
  'ALTER TABLE albums ADD COLUMN task_id BIGINT UNSIGNED NULL AFTER author_id',
  'SELECT 1'
);

PREPARE add_task_id_stmt FROM @add_task_id_sql;
EXECUTE add_task_id_stmt;
DEALLOCATE PREPARE add_task_id_stmt;

SET @task_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'albums'
    AND INDEX_NAME = 'idx_albums_task'
);

SET @add_task_index_sql = IF(
  @task_index_exists = 0,
  'ALTER TABLE albums ADD INDEX idx_albums_task (task_id)',
  'SELECT 1'
);

PREPARE add_task_index_stmt FROM @add_task_index_sql;
EXECUTE add_task_index_stmt;
DEALLOCATE PREPARE add_task_index_stmt;

SET @task_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'albums'
    AND CONSTRAINT_NAME = 'fk_albums_task'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @add_task_fk_sql = IF(
  @task_fk_exists = 0,
  'ALTER TABLE albums ADD CONSTRAINT fk_albums_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE add_task_fk_stmt FROM @add_task_fk_sql;
EXECUTE add_task_fk_stmt;
DEALLOCATE PREPARE add_task_fk_stmt;
