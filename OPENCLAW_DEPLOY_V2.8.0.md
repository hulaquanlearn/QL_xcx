# OpenClaw 部署任务：情侣空间服务端 v2.8.0

## 0. 执行边界

1. 只操作 `/opt/couple-space`、数据库 `couple_space`、PM2 进程 `couple-space-api` 和对应 Nginx 路由。
2. 不修改 `spare-parts`、其他数据库、其他 PM2 进程或端口。
3. 不创建、删除或修改菜单、订单、相册、清单等业务数据。
4. 不修改测试断言来绕过失败；源码、迁移、测试或本文预期不一致时立即停止并报告。
5. 不打印、复制、提交或回显 `.env`、AppSecret、Token、OpenID、密码和会话令牌。
6. 当前线上版本不是 `2.7.0` 时停止部署并报告实际版本，不得自行补跑未知迁移。

## 1. 本次更新

- 服务端版本升级为 `2.8.0`。
- Nginx API 路由加入 `client_max_body_size 6m`，避免相册和做法图被代理层拒绝。
- 创建资源时强制校验必填字段、真实日历日期、菜单来源、菜品数量和文本长度。
- 自动登录仅在 HTTP 401 时清理会话；断网、超时和 5xx 保留本地登录状态。
- 服务启动后立即清理媒体审核任务，之后每30分钟重复执行。
- 失败、拒绝和超时的媒体审核记录保留7天后自动清理。
- 微信身份只保留在 `sessions`，删除 `users.wechat_openid`、`users.wechat_seen_at` 和旧 `avatars` 表。
- 新增 HTTP 级输入校验、Nginx 配置、迁移和定时清理测试。

## 2. 部署前检查与备份

```bash
set -e
curl -fsS http://127.0.0.1:3001/api/couple-space/health
pm2 describe couple-space-api
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "/opt/couple-space/backup-$STAMP"
cp -a /opt/couple-space/server "/opt/couple-space/backup-$STAMP/server"
cp -a /opt/couple-space/data "/opt/couple-space/backup-$STAMP/data"
mysqldump -h 127.0.0.1 -u couple_space -p --single-transaction --routines --triggers couple_space > "/opt/couple-space/backup-$STAMP/couple_space.sql"
echo "$STAMP"
```

确认 health 版本为 `2.7.0`，且源码、数据库和图片备份全部成功。任一失败都停止。

## 3. 更新源码并运行测试

解压交付包后保留线上原 `.env`，不要使用示例文件覆盖：

```bash
cd /opt/couple-space/server
npm ci --omit=dev
npm test
```

本交付包预期：

```text
version: 2.8.0
tests: 33
pass: 33
fail: 0
```

数量、名称、断言或结果不一致时停止，不得只修改测试文字。

## 4. 数据库迁移

```bash
cd /opt/couple-space/server
test -f sql/migrate-v2.8.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.8.0.sql
```

迁移可重复执行。执行后只做结构查询，不读取或输出用户身份内容：

```bash
mysql -h 127.0.0.1 -u couple_space -p -N -e "
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='couple_space' AND TABLE_NAME='users'
  AND COLUMN_NAME IN ('wechat_openid','wechat_seen_at');
SELECT COUNT(*) FROM information_schema.TABLES
WHERE TABLE_SCHEMA='couple_space' AND TABLE_NAME='avatars';
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='couple_space' AND TABLE_NAME='sessions'
  AND COLUMN_NAME IN ('wechat_openid','wechat_seen_at');
"
```

预期依次为 `0`、`0`、`2`。不符合时停止部署。

## 5. 更新 Nginx

把 `server/nginx/couple-space.conf.example` 中对应 location 合并到现有站点配置，不能覆盖其他业务配置。确认 API location 内存在：

```nginx
client_max_body_size 6m;
```

然后执行：

```bash
nginx -t
systemctl reload nginx
nginx -T 2>/dev/null | grep -A12 'location /api/couple-space/'
```

`nginx -t` 失败时禁止 reload。

## 6. 重启目标服务

```bash
cd /opt/couple-space/server
pm2 restart couple-space-api --update-env
pm2 save
pm2 status couple-space-api
```

不得重启其他进程。

## 7. 无业务写入验证

```bash
curl -fsS http://127.0.0.1:3001/api/couple-space/health
curl -fsS https://czsdsg.cn/api/couple-space/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://czsdsg.cn/api/couple-space/auth/register
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://czsdsg.cn/api/couple-space/partner/unbind
ss -lntp | grep -E '127\.0\.0\.1:3001|127\.0\.0\.1:3306'
pm2 logs couple-space-api --lines 100 --nostream
```

预期：

- 内外网 health 均为 HTTP 200，版本 `2.8.0`、数据库 `connected`、内容安全 `configured`。
- 注册和解绑接口均为404。
- API 与 MySQL 仍只监听本机回环地址。
- 启动日志存在正常监听信息，不存在媒体定时清理异常。
- 报告不得包含敏感字段。

## 8. 用户自行验收

OpenClaw 不创建业务测试数据。部署后由用户使用两个已有测试账号验证：

1. 断网后重新进入小程序不会被强制退出；恢复网络后数据可继续加载。
2. 会话真正失效时仍会返回登录页。
3. 连续点击登录按钮只发起一次登录。
4. 上传接近1.6MB的相册图片和接近1.2MB的做法图不会出现 Nginx 413。
5. 空菜单、空点单、无效纪念日日期会显示可理解提示，不产生脏数据。
6. 菜单、订单、相册、头像仍只在对应情侣空间内共享。
7. 原有点单闭环、相册多图、清单成果图和个人资料功能正常。

## 9. 回滚

发生测试失败、迁移失败、Nginx 检查失败、health 异常或服务无法启动时立即停止：

- 恢复第2步备份的 `server`、原 `.env`、Nginx 配置和数据目录。
- v2.8.0 会删除旧字段和旧表；若已执行迁移，必须恢复数据库备份，不能只回滚源码。
- 只重启 `couple-space-api`，再次验证内外网 health。

## 10. 最终回报

只回报脱敏结果：备份路径、版本、测试数量、迁移结构检查、Nginx 6m 配置、PM2 状态、内外网 health、404 检查、端口监听、日志结论和未处理问题。
