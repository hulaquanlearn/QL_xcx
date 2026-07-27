USE couple_space;

SET @avatar_key_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'avatar_key'
);

SET @add_avatar_key_sql = IF(
  @avatar_key_exists = 0,
  'ALTER TABLE users ADD COLUMN avatar_key VARCHAR(1000) NULL AFTER invite_code',
  'SELECT 1'
);

PREPARE add_avatar_key_stmt FROM @add_avatar_key_sql;
EXECUTE add_avatar_key_stmt;
DEALLOCATE PREPARE add_avatar_key_stmt;

UPDATE users u
JOIN avatars a ON a.couple_id = u.couple_id
SET u.avatar_key = CASE
  WHEN u.gender = 'male' AND a.male_url IS NOT NULL AND a.male_url <> '' THEN a.male_url
  WHEN u.gender = 'female' AND a.female_url IS NOT NULL AND a.female_url <> '' THEN a.female_url
  ELSE COALESCE(NULLIF(a.male_url, ''), NULLIF(a.female_url, ''))
END
WHERE u.avatar_key IS NULL
  AND u.couple_id IS NOT NULL;
