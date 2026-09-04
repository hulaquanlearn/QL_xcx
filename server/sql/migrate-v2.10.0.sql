USE couple_space;

-- Sensitive health records are owned by one account, not implicitly shared.
CREATE TABLE IF NOT EXISTS period_settings (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  share_with_partner TINYINT(1) NOT NULL DEFAULT 0,
  shared_couple_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_period_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_period_settings_couple FOREIGN KEY (shared_couple_id) REFERENCES couples(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS period_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  flow ENUM('unknown','light','medium','heavy') NOT NULL DEFAULT 'unknown',
  pain ENUM('unknown','none','mild','moderate','severe') NOT NULL DEFAULT 'unknown',
  symptoms JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_period_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_period_records_start (user_id,start_date),
  INDEX idx_period_records_dates (user_id,start_date,end_date)
) ENGINE=InnoDB;
