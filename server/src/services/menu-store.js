function parseLegacyDishes(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toClientDish(row) {
  return {
    id: String(row.id),
    name: row.name,
    image: row.image_key || '',
    recipeImage: row.recipe_image_key || '',
    ingredients: row.ingredients || '',
    steps: row.steps || '',
    tips: row.tips || ''
  };
}

async function attachNormalizedDishes(executor, coupleId, menuRows) {
  if (!menuRows.length) return menuRows;
  const ids = menuRows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [items] = await executor.query(
    `SELECT mi.menu_id,d.id,d.name,d.image_key,d.recipe_image_key,d.ingredients,d.steps,d.tips
     FROM menu_items mi
     JOIN menus m ON m.id=mi.menu_id AND m.couple_id=?
     JOIN dishes d ON d.id=mi.dish_id AND d.couple_id=m.couple_id
     WHERE mi.menu_id IN (${placeholders})
     ORDER BY mi.menu_id,mi.position`,
    [coupleId, ...ids]
  );
  const byMenu = new Map();
  for (const item of items) {
    const key = String(item.menu_id);
    if (!byMenu.has(key)) byMenu.set(key, []);
    byMenu.get(key).push(toClientDish(item));
  }
  return menuRows.map(row => ({
    ...row,
    dishes: byMenu.get(String(row.id)) || parseLegacyDishes(row.dishes)
  }));
}

async function syncMenuDishes(executor, coupleId, authorId, menuId, dishes) {
  await executor.query('DELETE FROM menu_items WHERE menu_id=?', [menuId]);
  for (let position = 0; position < dishes.length; position += 1) {
    const dish = dishes[position];
    const [created] = await executor.query(
      `INSERT INTO dishes(couple_id,author_id,name,image_key,recipe_image_key,ingredients,steps,tips)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        coupleId,
        authorId,
        dish.name,
        dish.image || '',
        dish.recipeImage || '',
        dish.ingredients || '',
        dish.steps || '',
        dish.tips || ''
      ]
    );
    await executor.query(
      'INSERT INTO menu_items(menu_id,dish_id,position) VALUES(?,?,?)',
      [menuId, created.insertId, position]
    );
  }
}

async function removeOrphanDishes(executor, coupleId) {
  await executor.query(
    `DELETE d FROM dishes d
     LEFT JOIN menu_items mi ON mi.dish_id=d.id
     WHERE d.couple_id=? AND mi.dish_id IS NULL`,
    [coupleId]
  );
}

module.exports = {
  attachNormalizedDishes,
  parseLegacyDishes,
  removeOrphanDishes,
  syncMenuDishes,
  toClientDish
};
