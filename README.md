# 情侣空间小程序

原生微信小程序，提供纪念日、相册、必做清单、今日点菜、情侣绑定和个人资料等功能。业务链路为“微信小程序 → HTTPS REST API → MySQL + 服务器私有图片目录”。新上传的头像、相册和菜品图片不再依赖微信云存储。

## 目录

- `miniprogram/`：小程序页面、统一 API 服务和会话管理。
- `server/`：Node.js、Express、MySQL API。
- `server/sql/schema.sql`：全新安装所需的完整数据库结构。

## 本地启动 API

```powershell
cd server
Copy-Item .env.example .env
npm install
mysql -u root -p < sql/schema.sql
npm start
```

在 `.env` 中填写 MySQL 用户和密码。生产环境建议为 `couple_space` 创建只能访问同名数据库的独立账号，不要复用 `xiangmu` 项目的数据库账号。

## 已有服务器更新

当前版本仍保持9张表，但已有服务器需要依次补齐头像字段、菜单唯一索引和清单照片关联字段：

```bash
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.1.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.2.1.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.3.0.sql
mkdir -p /opt/couple-space/data/avatars /opt/couple-space/data/media
```

在服务器 `.env` 中保留或加入：

```dotenv
AVATAR_DIR=/opt/couple-space/data/avatars
MEDIA_DIR=/opt/couple-space/data/media
```

然后执行：

```bash
cd /opt/couple-space/server
npm ci --omit=dev
npm test
pm2 restart couple-space-api
pm2 save
```

验证健康接口返回的 `data.version` 为 `2.3.0`，并确认个人资料接口无 Token 时返回 401 而不是 404：

```bash
curl -sS http://127.0.0.1:3001/api/couple-space/health
curl -sS https://czsdsg.cn/api/couple-space/health
curl -sS -i -X PATCH -H 'Content-Type: application/json' -d '{}' https://czsdsg.cn/api/couple-space/profile
```

## 全新服务器部署

1. 将 `server/` 部署到 `/opt/couple-space/server`。
2. 执行 `sql/schema.sql`，创建独立数据库和全部数据表。
3. 使用 PM2 监听 `127.0.0.1:3001`。
4. 在现有 Nginx HTTPS 站点增加 `/api/couple-space/` 反向代理到 `http://127.0.0.1:3001`。
5. 微信公众平台的 `request 合法域名` 保留 `https://czsdsg.cn`。

Nginx 示例见 `server/nginx/couple-space.conf.example`。

## 账号由服务器管理员创建

个人主体小程序不提供用户自助注册，也没有公开注册接口。需要新增账号时，在服务器 `/opt/couple-space/server/.env` 中临时加入：

```dotenv
CREATE_USER_ACCOUNT=user_a
CREATE_USER_PASSWORD=至少8位的临时密码
CREATE_USER_NAME=用户昵称
CREATE_USER_GENDER=male
```

执行 `npm run create-user`。成功后立即从 `.env` 删除全部 `CREATE_USER_*` 配置。脚本不会覆盖已有账号，数据库中仅保存带随机盐的 `scrypt` 哈希。性别可以填写 `male`、`female` 或 `other`。

不要直接向 `users.password_hash` 写入明文密码。

## 今日点菜

- 点菜、订单和菜单管理分开，默认进入“点菜”视图。
- 支持早餐、午餐、晚餐和加餐筛选。
- 菜品以双列卡片展示，可多选后一次发给对方。
- 菜单管理支持按“菜单名：菜品1、菜品2”逐行批量导入，每次最多20个菜单。
- 同一情侣空间内菜单名称必须唯一；单个新建、重命名和批量导入都会拦截重名。
- 接单使用独立的服务端接口，只有同一情侣空间内的另一方可以接待处理的点单。
- 选择菜品图片后立即显示本地预览，仅图片区域显示上传状态，避免整页闪烁。
- 菜单和菜品仍使用原有 `/resources/menus`、`/resources/orders` 接口，兼容现有数据。

## 清单与相册

- 清单完成后可以一次选择最多9张成果照片，并可反复追加。
- 关联照片仍属于共同相册，相册会显示“来自清单”的来源。
- 删除清单只解除来源关联，照片继续保留在相册中。
- 服务端按当前情侣空间校验清单和照片，不能关联其他情侣的数据。

## 私有图片与跨设备同步

- 每个账号在 `users.avatar_key` 保存自己的头像键，不再用“男/女”槽位区分头像。
- 新头像保存到 `AVATAR_DIR`；新相册和菜品图片保存到 `MEDIA_DIR/<couple_id>/`。
- 图片下载必须携带登录令牌；服务端同时校验当前账号的 `couple_id`，其他情侣无法读取。
- 同一情侣空间的两位成员从同一个服务器图片文件读取，因此手机端和开发者工具看到的是同一张图。
- 旧 `cloud://` 图片继续可读；小程序读取成功后会逐步迁移到服务器，原云文件不会自动删除。
- 微信公众平台必须把 `https://czsdsg.cn` 同时配置为 `request` 和 `downloadFile` 合法域名。

## 安全设计

- 密码使用带随机盐的 `scrypt` 哈希。
- 会话令牌在数据库中仅保存 SHA-256 哈希。
- 所有业务读写由服务端按登录用户的 `couple_id` 限制。
- 相册和菜品图片键包含情侣空间编号，不能写入其他情侣空间的图片键。
- 点单内容和删除操作只允许发起人执行，接单人不能接自己的点单。
- 情侣绑定使用事务和行锁，避免只绑定一方。
- MySQL 端口不应暴露到公网，小程序不会直接连接 MySQL。
