# 情侣空间 v2.9.0 OpenClaw 部署说明

只更新 `/opt/couple-space/server` 和数据库 `couple_space`，不得改动 `spare-parts`。微信 AppID、AppSecret、JSON 回调和平台 URL 已配置完成，本次不要重置或回显任何密钥。

## 0. 部署边界

- 先备份服务端源码、`.env`、数据库和 `/opt/couple-space/data`。
- 保留原 `.env`，部署包不包含生产密钥。
- API、MySQL 继续只监听 `127.0.0.1`。
- 任一 SQL、迁移脚本或测试失败就停止，不启动新版进程。
- 测试数量以交付包实际结果为准，要求 `fail: 0`，不要写死历史数量。

## 1. 备份

```bash
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "/opt/couple-space/backup-$stamp"
cp -a /opt/couple-space/server "/opt/couple-space/backup-$stamp/server"
cp -a /opt/couple-space/data "/opt/couple-space/backup-$stamp/data"
mysqldump -h 127.0.0.1 -u couple_space -p --single-transaction couple_space > "/opt/couple-space/backup-$stamp/couple_space.sql"
```

## 2. 更新源码

将压缩包中的 `server/` 覆盖到 `/opt/couple-space/server`，但恢复并保留原生产 `.env`。确认没有上传 `node_modules`、业务图片、日志或本地缓存。

## 3. 数据库升级与旧菜单迁移

```bash
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.9.0.sql
npm ci --omit=dev
npm run migrate-menu-data
```

`migrate-menu-data` 可重复执行：已经存在 `menu_items` 的菜单会跳过。迁移后保留 `menus.dishes` 作为兼容缓存，不能删除旧列；订单的 `orders.dishes` 是历史快照，也不能改成动态引用。

## 4. 验证并重启

```bash
cd /opt/couple-space/server
npm test
pm2 restart couple-space-api
pm2 save
curl -sS http://127.0.0.1:3001/api/couple-space/health
curl -sS https://czsdsg.cn/api/couple-space/health
```

健康接口版本必须是 `2.9.0`、数据库状态必须是 `connected`。确认以下表存在：`dishes`、`menu_items`、`weekly_menu_plans`、`shopping_items`。

## 5. 脱敏回报

回报备份路径、SQL 与菜单迁移结果、`npm test` 实际 total/pass/fail、PM2 状态、内外网 health 状态码、4 张新表检查，以及最近日志是否存在异常。不得粘贴 `.env`、数据库密码、AppSecret、会话令牌或 OpenID。
