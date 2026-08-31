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
CREATE TABLE IF NOT EXISTS dishes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  couple_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  image_key VARCHAR(1000) NULL,
  recipe_image_key VARCHAR(1000) NULL,
  ingredients TEXT NOT NULL,
  steps TEXT NOT NULL,
  tips TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dishes_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_dishes_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_dishes_couple_name (couple_id,name),
  INDEX idx_dishes_couple_updated (couple_id,updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS menu_items (
  menu_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_id,dish_id),
  UNIQUE KEY uq_menu_items_position (menu_id,position),
  CONSTRAINT fk_menu_items_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
  CONSTRAINT fk_menu_items_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS weekly_menu_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  couple_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  week_start DATE NOT NULL,
  day_index TINYINT UNSIGNED NOT NULL,
  meal_type ENUM('breakfast','lunch','dinner','snack') NOT NULL,
  menu_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_weekly_plans_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_weekly_plans_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_weekly_plans_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
  UNIQUE KEY uq_weekly_plan_slot (couple_id,week_start,day_index,meal_type),
  INDEX idx_weekly_plans_week (couple_id,week_start)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS shopping_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  couple_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  week_start DATE NOT NULL,
  name VARCHAR(150) NOT NULL,
  quantity VARCHAR(80) NOT NULL DEFAULT '',
  source ENUM('manual','plan') NOT NULL DEFAULT 'manual',
  checked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shopping_items_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_shopping_items_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_shopping_items_week (couple_id,week_start,checked,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, couple_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  dishes JSON NOT NULL, menu_names JSON NULL, meal_type ENUM('breakfast','lunch','dinner','snack') NOT NULL DEFAULT 'lunch', order_by VARCHAR(40) NOT NULL DEFAULT '', note VARCHAR(500) NOT NULL DEFAULT '', status ENUM('pending','accepted','ready','completed') NOT NULL DEFAULT 'pending', accepted_by VARCHAR(40) NULL, accepted_by_user_id BIGINT UNSIGNED NULL, accepted_at DATETIME NULL, ready_at DATETIME NULL, completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_accepted_by_user FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders (couple_id,status,created_at), INDEX idx_orders_accepted_by (accepted_by_user_id,status)
) ENGINE=InnoDB;
