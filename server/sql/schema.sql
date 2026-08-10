CREATE DATABASE IF NOT EXISTS couple_space CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE couple_space;

CREATE TABLE IF NOT EXISTS couples (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account VARCHAR(40) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(40) NOT NULL,
  gender ENUM('male','female','other') NOT NULL DEFAULT 'other',
  invite_code CHAR(8) NOT NULL UNIQUE,
  avatar_key VARCHAR(1000) NULL,
  couple_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE SET NULL,
  INDEX idx_users_couple (couple_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  wechat_openid VARCHAR(64) NULL,
  wechat_seen_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_expires (expires_at),
  INDEX idx_sessions_wechat_seen (user_id,wechat_seen_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS media_checks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  couple_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('avatar','album','dish','recipe') NOT NULL,
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

CREATE TABLE IF NOT EXISTS countdowns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL, event_date DATE NOT NULL, description VARCHAR(500) NOT NULL DEFAULT '', is_anniversary TINYINT(1) NOT NULL DEFAULT 0, is_top TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE, INDEX idx_countdowns (couple_id,event_date)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(150) NOT NULL, description VARCHAR(500) NOT NULL DEFAULT '', status ENUM('pending','completed') NOT NULL DEFAULT 'pending', completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE, INDEX idx_tasks (couple_id,status,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS albums (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL, task_id BIGINT UNSIGNED NULL,
  image_url VARCHAR(1000) NOT NULL, storage_key VARCHAR(500) NULL, description VARCHAR(300) NOT NULL DEFAULT '', photo_date DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_albums_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  INDEX idx_albums (couple_id,created_at), INDEX idx_albums_task (task_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS menus (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL, meal_type ENUM('breakfast','lunch','dinner','snack') NOT NULL DEFAULT 'dinner', dishes JSON NOT NULL, image_url VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE, INDEX idx_menus (couple_id,created_at), UNIQUE KEY uq_menus_couple_name (couple_id,name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  dishes JSON NOT NULL, menu_names JSON NULL, meal_type ENUM('breakfast','lunch','dinner','snack') NOT NULL DEFAULT 'lunch', order_by VARCHAR(40) NOT NULL DEFAULT '', note VARCHAR(500) NOT NULL DEFAULT '', status ENUM('pending','accepted','ready','completed') NOT NULL DEFAULT 'pending', accepted_by VARCHAR(40) NULL, accepted_by_user_id BIGINT UNSIGNED NULL, accepted_at DATETIME NULL, ready_at DATETIME NULL, completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_accepted_by_user FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders (couple_id,status,created_at), INDEX idx_orders_accepted_by (accepted_by_user_id,status)
) ENGINE=InnoDB;
