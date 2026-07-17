# OpenClaw 更新部署清单

任何步骤失败立即停止并回报。不得影响 `spare-parts-api`、Dify、OpenClaw Gateway、Nginx 和 `spare_parts` 数据库；密码与令牌必须打码。

1. 备份 `/opt/couple-space/server`，解压新版 `couple-space-server.zip` 覆盖情侣空间服务端源码，但保留服务器现有 `.env`。
2. 在 `/opt/couple-space/server` 执行：

```bash
npm install --omit=dev
npm test
```

3. 确认小程序为个人主体：公开注册接口必须已删除，小程序界面不得出现“注册”或“创建账号”。验证：

```bash
curl -i -X POST 'https://czsdsg.cn/api/couple-space/auth/register' \
  -H 'Content-Type: application/json' \
  --data '{"account":"forbidden","password":"forbidden"}'
```

必须返回 `404`。

4. 重启并验证：

```bash
pm2 restart couple-space-api --update-env
pm2 save
pm2 status couple-space-api
pm2 logs couple-space-api --lines 100 --nostream
curl -i http://127.0.0.1:3001/api/couple-space/health
curl -i https://czsdsg.cn/api/couple-space/health
```

5. 以后新增账号只能由服务器管理员操作。在 `/opt/couple-space/server/.env` 临时加入：

```dotenv
CREATE_USER_ACCOUNT=账号
CREATE_USER_PASSWORD=至少8位的临时密码
CREATE_USER_NAME=昵称
CREATE_USER_GENDER=male
```

执行：

```bash
cd /opt/couple-space/server
npm run create-user
```

创建成功后，立即从 `.env` 删除全部 `CREATE_USER_*` 配置并执行 `pm2 restart couple-space-api --update-env`。禁止直接向 MySQL 写入明文密码，禁止恢复 HTTP 注册接口。

6. 回报：备份路径、测试结果、PM2 状态、内外网 health、注册接口 `404` 检查结果和脱敏日志结论。不得回传 `.env`、密码或完整 Token。
