require('dotenv').config();
const { pool } = require('../src/db');
const { parseLegacyDishes, syncMenuDishes } = require('../src/services/menu-store');

async function run() {
  const [menus] = await pool.query(
    `SELECT id,couple_id,author_id,dishes
     FROM menus
     ORDER BY couple_id,id`
  );
  let migrated = 0;
  let skipped = 0;
  for (const menu of menus) {
    const [existing] = await pool.query('SELECT 1 FROM menu_items WHERE menu_id=? LIMIT 1', [menu.id]);
    if (existing[0]) {
      skipped += 1;
      continue;
    }
    const dishes = parseLegacyDishes(menu.dishes);
    if (!dishes.length) {
      skipped += 1;
      continue;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await syncMenuDishes(connection, menu.couple_id, menu.author_id, menu.id, dishes.map(dish => ({
        name: String(dish?.name || '').trim(),
        image: String(dish?.imageKey || dish?.image || ''),
        recipeImage: String(dish?.recipeImageKey || dish?.recipeImage || ''),
        ingredients: String(dish?.ingredients || ''),
        steps: String(dish?.steps || ''),
        tips: String(dish?.tips || '')
      })).filter(dish => dish.name));
      await connection.commit();
      migrated += 1;
    } catch (error) {
      await connection.rollback();
      throw new Error(`菜单 ${menu.id} 迁移失败：${error.message}`);
    } finally {
      connection.release();
    }
  }
  console.log(`菜单规范化完成：迁移 ${migrated}，跳过 ${skipped}`);
}

run()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
