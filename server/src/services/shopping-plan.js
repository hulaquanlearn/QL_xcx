const { ApiError } = require('../utils');

function splitIngredients(value) {
  return String(value || '').split(/[\n；;、]+/)
    .map(item => item.replace(/^[-•·\s]+/, '').trim()).filter(Boolean).slice(0, 80);
}

function ingredientKey(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function buildIngredientItems(menus) {
  const byName = new Map();
  for (const menu of menus) {
    for (const dish of menu.dishes || []) {
      if (!dish) continue;
      for (const raw of splitIngredients(dish.ingredients)) {
        const name = raw.slice(0, 150);
        const key = ingredientKey(name);
        if (!byName.has(key)) byName.set(key, { name, sources: [] });
        const item = byName.get(key);
        const source = { menuId: String(menu.id), menuName: menu.name || '', dishId: String(dish.id || ''), dishName: dish.name || '' };
        if (!item.sources.some(existing => existing.menuId === source.menuId && existing.dishId === source.dishId && existing.dishName === source.dishName)) {
          item.sources.push(source);
        }
      }
    }
  }
  return [...byName.values()];
}

async function mergeShoppingPlan(connection, coupleId, authorId, weekStart, items) {
  if (items.length > 120) throw new ApiError(400, '本周食材超过120项，请减少菜单后重试');
  const [existing] = await connection.query(
    "SELECT id,name,checked,quantity FROM shopping_items WHERE couple_id=? AND week_start=? AND source='plan' FOR UPDATE",
    [coupleId, weekStart]
  );
  const wanted = new Set(items.map(item => ingredientKey(item.name)));
  const known = new Set(existing.map(item => ingredientKey(item.name)));
  let removed = 0;
  let added = 0;
  for (const row of existing) {
    if (!wanted.has(ingredientKey(row.name))) {
      await connection.query("DELETE FROM shopping_items WHERE id=? AND couple_id=? AND source='plan'", [row.id, coupleId]);
      removed++;
    }
  }
  for (const item of items) {
    if (known.has(ingredientKey(item.name))) continue;
    await connection.query(
      "INSERT INTO shopping_items(couple_id,author_id,week_start,name,source) VALUES(?,?,?,?,'plan')",
      [coupleId, authorId, weekStart, item.name]
    );
    added++;
  }
  return { count: items.length, added, removed, preserved: existing.length - removed };
}

module.exports = { buildIngredientItems, ingredientKey, mergeShoppingPlan, splitIngredients };
