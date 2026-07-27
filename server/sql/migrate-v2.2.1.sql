USE couple_space;

SET @menu_name_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'menus'
    AND INDEX_NAME = 'uq_menus_couple_name'
);

SET @add_menu_name_index_sql = IF(
  @menu_name_index_exists = 0,
  'ALTER TABLE menus ADD UNIQUE KEY uq_menus_couple_name (couple_id, name)',
  'SELECT 1'
);

PREPARE add_menu_name_index_stmt FROM @add_menu_name_index_sql;
EXECUTE add_menu_name_index_stmt;
DEALLOCATE PREPARE add_menu_name_index_stmt;
