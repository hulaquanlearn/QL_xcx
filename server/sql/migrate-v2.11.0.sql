USE couple_space;

-- Private favorites are account-specific. No existing photos or records are
-- overwritten, and completed_at is deliberately not backfilled with fake dates.
CREATE TABLE IF NOT EXISTS album_favorites (
  album_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id,user_id),
  INDEX idx_album_favorites_user (user_id,album_id),
  CONSTRAINT fk_album_favorites_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_album_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
