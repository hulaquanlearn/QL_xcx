# 情侣空间小程序

原生微信小程序，提供纪念日、相册、必做清单、点菜、情侣绑定和个人资料功能。业务数据已从微信云数据库迁移为“微信小程序 → HTTPS REST API → MySQL”；微信云存储暂时只负责图片文件。

## 目录

- `miniprogram/`：小程序页面、统一 API 服务和会话管理。
- `server/`：Node.js/Express/MySQL API。
- `server/sql/schema.sql`：独立的 `couple_space` 数据库结构。

## 本地启动 API

```powershell
cd server
Copy-Item .env.example .env
npm install
mysql -u root -p < sql/schema.sql
npm start
```

在 `.env` 中填写 MySQL 用户和密码。生产环境建议为 `couple_space` 创建仅能访问同名数据库的独立 MySQL 账号，不要复用 `xiangmu` 项目的 `spareparts` 账号。

## 服务器部署

1. 将 `server/` 部署至与现有 MySQL 同一服务器，例如 `/opt/couple-space/server`。
2. 执行 `sql/schema.sql`，创建独立数据库和表。
3. 使用 PM2 监听 `127.0.0.1:3001`。
4. 在现有 Nginx HTTPS 站点增加 `/api/couple-space/` 反向代理到 `http://127.0.0.1:3001`。
5. 微信公众平台的 `request 合法域名` 保留 `https://czsdsg.cn`。

示例 Nginx 配置见 `server/nginx/couple-space.conf.example`。

## 账号由服务器管理员创建

个人主体小程序不提供用户自助注册，也没有公开注册接口。需要新增账号时，在服务器 `/opt/couple-space/server/.env` 中临时加入：

```dotenv
CREATE_USER_ACCOUNT=user_a
CREATE_USER_PASSWORD=至少8位的临时密码
CREATE_USER_NAME=用户昵称
CREATE_USER_GENDER=male
```

执行 `npm run create-user`，成功后立即从 `.env` 删除全部 `CREATE_USER_*` 配置。脚本不会覆盖已有账号，数据库中仅保存带随机盐的 `scrypt` 哈希。性别可填写 `male`、`female` 或 `other`。

不要直接向 `users.password_hash` 写入明文密码。

## 数据迁移说明

旧云数据库的集合为 `users、countdown、album、avatars、tasks、menus、orders`。密码不能继续以明文迁移：账号应由服务器管理员使用 `npm run create-user` 重新创建，或使用一次性离线脚本把旧密码转换为 `scrypt` 哈希后再导入。图片 URL/云文件 ID 可以作为相册和头像元数据迁移到 MySQL。

## 安全设计

- 密码使用带随机盐的 `scrypt` 哈希。
- 会话令牌在数据库中仅保存 SHA-256 哈希。
- 所有业务读写由服务端按登录用户的 `couple_id` 限制。
- 情侣绑定使用事务和行锁，避免只绑定一方。
- MySQL 端口不应暴露到公网，小程序也不会直接连接 MySQL。
