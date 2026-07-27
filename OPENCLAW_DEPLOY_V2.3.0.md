# OpenClaw 部署任务：情侣空间服务端 v2.3.0

请严格执行本任务。发现源码、测试或预期结果不一致时立即停止并报告具体文件、行号、期望值和实际值；不得为了继续部署而只修改测试，也不得未经用户确认擅自修改交付包。

## 本次更新

- 新增独立接单接口：`POST /api/couple-space/resources/orders/:id/accept`。
- 接单操作使用原子条件更新：必须属于同一情侣空间、不能是发起人、订单必须仍为 `pending`。
- 新增批量菜单接口：`POST /api/couple-space/resources/menus/batch`。
- 批量导入每次最多20个菜单，在同一数据库事务中全部成功或全部回滚。
- 同一情侣空间内菜单名称必须唯一，单个新建、重命名和批量导入均受限制。
- 新增数据库唯一索引 `uq_menus_couple_name(couple_id,name)`，防止双方并发创建重名菜单。
- 新增清单多照片关联接口：`POST /api/couple-space/resources/albums/task-photos`。
- `albums.task_id` 记录照片来源清单，删除清单时只置空关联，照片继续保留。
- 每次可关联1至9张照片，可重复调用继续追加。
- 统一订单删除提示文案与测试逻辑。
- 不增加数据库表；为 `albums` 增加可空的 `task_id` 字段、索引和外键。
- 不恢复注册或聊天功能。

## 安全边界

1. 部署目录仅限 `/opt/couple-space/server`。
2. 保留原 `/opt/couple-space/server/.env`，不得覆盖、删除或输出秘密。
3. 只重启 `couple-space-api`，不得操作其他 PM2 进程。
4. API 继续监听 `127.0.0.1:3001`，MySQL 继续监听 `127.0.0.1:3306`。
5. 只使用现有 `couple_space` 数据库，不修改其他数据库。
6. 保留 `/opt/couple-space/data/avatars` 和 `/opt/couple-space/data/media`。
7. 现有 Nginx `/api/couple-space/` 代理可用时不得修改。
8. 只允许按检查结果执行 `sql/migrate-v2.1.0.sql`、`sql/migrate-v2.2.1.sql` 和 `sql/migrate-v2.3.0.sql`；不得新建表或执行 `schema.sql`。

## 1. 部署前检查和备份

```bash
node -v
pm2 status
ss -lntp | grep -E ':(3001|3306)\b'

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=/opt/couple-space/backup-$STAMP
mkdir -p "$BACKUP"
cp -a /opt/couple-space/server "$BACKUP/server"

if [ -d /opt/couple-space/data/avatars ]; then
  cp -a /opt/couple-space/data/avatars "$BACKUP/avatars"
fi
if [ -d /opt/couple-space/data/media ]; then
  cp -a /opt/couple-space/data/media "$BACKUP/media"
fi

mysqldump -h 127.0.0.1 -u couple_space -p \
  --single-transaction --skip-lock-tables couple_space \
  > "$BACKUP/couple_space.sql"
test -s "$BACKUP/couple_space.sql"
```

如数据库用户名不同，以原 `.env` 为准；密码必须交互输入，不得写入日志。

## 2. 更新源码

将交付包内 `server/` 同步到 `/opt/couple-space/server/`：

- 保留原 `.env`。
- 不上传 `node_modules`。
- 不删除图片目录。
- 不改其他项目目录。

确认版本：

```bash
cd /opt/couple-space/server
node -p "require('./package.json').version"
```

必须输出 `2.3.0`。

## 3. 安装依赖和测试

```bash
cd /opt/couple-space/server
npm ci --omit=dev
npm test
```

交付源码当前定义了14项服务端测试，预期结果为：

```text
14 pass
0 fail
```

如果数量或结果不同：

1. 停止部署，不重启服务。
2. 返回失败测试名称、文件、行号、断言期望和实际结果。
3. 不得只修改断言文案来绕过失败。
4. 等待用户提供新的交付包或明确授权。

## 4. 数据库预检查和迁移

先执行头像字段的幂等迁移，再检查当前数据库是否已经存在重名菜单：

```bash
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space \
  < sql/migrate-v2.1.0.sql

mysql -h 127.0.0.1 -u couple_space -p couple_space -e \
  "SELECT couple_id,name,COUNT(*) count FROM menus GROUP BY couple_id,name HAVING COUNT(*)>1;"
```

查询结果必须为空。如果存在记录：

1. 停止部署，不执行迁移和重启。
2. 返回 `couple_id`、菜单名称和重复数量。
3. 不得擅自删除或重命名菜单，等待用户处理。

没有重复后执行幂等迁移：

```bash
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space \
  < sql/migrate-v2.2.1.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space \
  < sql/migrate-v2.3.0.sql
```

迁移后只读检查：

```bash
mysql -h 127.0.0.1 -u couple_space -p couple_space -e \
  "SHOW INDEX FROM menus WHERE Key_name='uq_menus_couple_name'; SHOW COLUMNS FROM albums LIKE 'task_id'; SHOW INDEX FROM albums WHERE Key_name='idx_albums_task'; SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='albums' AND CONSTRAINT_NAME='fk_albums_task'; SHOW COLUMNS FROM users LIKE 'avatar_key'; SHOW TABLES; SHOW TABLES LIKE 'messages';"
```

必须确认：

- `uq_menus_couple_name` 存在并包含 `couple_id,name`。
- `albums.task_id`、`idx_albums_task` 和 `fk_albums_task` 均存在。
- `users.avatar_key` 存在。
- 原有9张表存在。
- 不存在 `messages` 表。

## 5. 仅重启目标服务

```bash
pm2 restart couple-space-api
pm2 save
pm2 status
```

确认其他 PM2 进程未被重启、删除或改变。

## 6. 无业务数据写入的接口检查

健康检查：

```bash
curl -sS -i http://127.0.0.1:3001/api/couple-space/health
curl -sS -i https://czsdsg.cn/api/couple-space/health
```

两处必须为 HTTP 200，`data.version` 必须为 `2.3.0`。

以下新接口不带 Token 时必须返回401，证明路由存在且受认证保护：

```bash
curl -sS -i -X POST \
  https://czsdsg.cn/api/couple-space/resources/orders/1/accept

curl -sS -i -X POST \
  -H 'Content-Type: application/json' \
  -d '{"menus":[]}' \
  https://czsdsg.cn/api/couple-space/resources/menus/batch

curl -sS -i -X POST \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"1","images":[]}' \
  https://czsdsg.cn/api/couple-space/resources/albums/task-photos
```

公开注册和聊天接口必须继续返回404：

```bash
curl -sS -i -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  https://czsdsg.cn/api/couple-space/auth/register

curl -sS -i https://czsdsg.cn/api/couple-space/messages
```

检查监听地址和脱敏日志：

```bash
ss -lntp | grep -E ':(3001|3306)\b'
pm2 logs couple-space-api --lines 100 --nostream
```

## 7. 不由 OpenClaw 执行的验收

以下操作会写入业务数据，由用户部署后自行测试，OpenClaw 不要代替用户执行：

- 测试账号A发起点单，账号B接单。
- 批量导入多个菜单并检查另一账号是否可见。
- 尝试新建、重命名和批量导入同名菜单，确认均被阻止。
- 给菜品选择图片并观察预览与上传状态。
- 完成清单后一次选择多张照片，并再次追加照片。
- 在共同相册检查“来自清单”来源。
- 删除测试清单后确认照片仍保留在相册。

## 8. 最终回报

请逐项返回：

1. 源码、数据库、头像和媒体目录备份路径。
2. 部署版本号。
3. `npm test` 的测试总数、pass和fail。
4. 重名菜单预检查结果及 `uq_menus_couple_name` 索引结果。
5. `albums.task_id`、索引和外键检查结果。
6. `users.avatar_key`、9张表及无 `messages` 表的检查结果。
7. PM2 状态和其他进程未受影响结论。
8. 内网、公网 health 状态码及版本。
9. 接单、批量菜单和清单照片接口无 Token 返回401。
10. register和messages返回404。
11. 3001和3306监听地址。
12. 脱敏日志结论。
13. 尚未处理的问题；没有则写“无”。
