USE couple_space;

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
