# 情侣空间小程序

原生微信小程序，提供纪念日、共同相册、必做清单、今日点菜、情侣绑定和个人资料。业务链路为：

`微信小程序 → HTTPS REST API → MySQL + 服务器私有图片目录`

公开注册和聊天功能均不存在。账号由服务器管理员手动创建；所有业务数据由服务端按登录用户的 `couple_id` 隔离。

## 目录

- `miniprogram/`：小程序页面、统一 API 服务和会话管理。
- `server/`：Node.js、Express、MySQL API。
- `server/sql/schema.sql`：全新安装所需的完整数据库结构。
- `server/sql/migrate-v2.5.0.sql` 至 `migrate-v2.9.0.sql`：已有服务器升级所需的幂等迁移。

## v2.9.0 更新

- 新增“周菜单”：按周安排午餐和晚餐，并可从菜品食材说明生成采购清单。
- 采购清单支持两人共同勾选、手工追加和删除；情侣数据继续按 `couple_id` 隔离。
- 清单页新增“共同时间线”，自动汇集已完成清单、关联照片、相册照片和已完成点单。
- 菜品从菜单 JSON 逐步规范化到 `dishes`、`menu_items`，旧菜单 JSON 保留为兼容缓存，历史订单继续保留不可变快照。
- 服务端拆分订单、相册、周计划和时间线路由；情侣权限入口集中到 `couple-access.js`。
- 菜单页的图片展示逻辑移至独立模块，周计划使用独立页面，降低单页维护复杂度。
- 新增本地图片引用测试，避免删除仍被 WXML 引用的图标。

## v2.8.0 基础能力

- Nginx API 路由允许最大 `6m` 请求体，匹配 Base64 图片上传体积。
- 服务端拒绝空菜单、空点单、缺少必填字段、无效日历日期和超长说明，不再把输入错误变成 MySQL 500。
- 自动登录遇到断网、超时或服务暂不可用时保留本地会话，只有明确的 HTTP 401 才清理登录状态。
- 登录按钮增加重复提交保护，避免快速连点创建多条会话。
- 媒体审核清理改为服务启动后立即执行并每30分钟运行；失败、拒绝和超时记录保留7天后删除。
- 微信身份只保留在 `sessions`，移除 `users` 中的旧身份字段和不再使用的 `avatars` 表。
- 新增 HTTP 级输入校验测试，不再只依赖源码字符串断言。

## v2.7.0 基础能力

- 菜品支持可选的制作说明图、食材与用量、制作步骤和小贴士。
- 制作说明图沿用菜品图片的安全审核、情侣隔离存储和跨设备同步机制。
- 点单时复制菜品做法形成订单快照，后续修改菜单不会改变历史订单内容。
- 新增独立制作说明页，多道菜可以切换查看，长图保持原比例并支持放大。
- 接单成功后可以立即进入制作说明页，也可以稍后从订单列表打开。
- 点单闭环升级为“待接单 → 制作中 → 待确认 → 已完成”：接单人标记已做好，下单人确认收到。
- 兼容旧版 `/orders/:id/complete` 请求，但该入口只会进入“待确认”，不能跳过下单人确认。
- 订单接单后锁定菜品快照，不能再通过通用更新接口改变制作内容。
- 菜单与订单列表只加载封面，打开制作说明时才下载做法长图。
- 未保存的菜品图片会主动回收；服务端也会定期清理超过24小时仍未引用的审核图片。
- 同一菜单禁止重名菜品；相册批量删除改为单事务，避免只删掉一部分。
- 登录失效时统一清理全局状态并返回登录页；头像上传期间禁止重复选择。

## v2.6.0 基础能力

- 小程序彻底移除云开发环境和 `wx.cloud` 兼容层，业务与图片统一使用自建 HTTPS API。
- 文字内容使用微信 `/wxa/msg_sec_check` V2 检测。
- 头像、相册和菜品图片使用 `/wxa/media_check_async` V2 异步检测。
- 待检测图片先进入隔离目录，只有微信签名回调返回 `pass` 后才进入正式目录。
- 微信 OpenID 只绑定当前登录会话，不再与本地账号唯一绑定；一个微信号可以切换多个手工账号。
- 账号密码仍负责鉴权，情侣数据仍按账号的 `couple_id` 隔离。
- 小程序切换账号和退出登录时会清理内存图片缓存。
- 新增 `media_checks` 表；v2.9.0 继续增加规范化菜品、周计划和采购清单表。
- 图片按头像、菜品和相册分别采用清晰度策略，不再把运行时照片错误压缩到190KB。
- 相册使用游标分页，每页30张并支持触底继续加载。
- 图片下载增加并发请求合并和有界缓存，菜单与订单不再重复下载同一张图片。
- 点单记录接单人身份，并限制只有对方可以接单。
- 暂不提供解绑功能，客户端和服务端均已移除旧接口。
- 相册完整页面按原图比例展示，不再强制裁成正方形。
- 修复部分 iOS 无法解析 `YYYY-MM-DD HH:mm:ss` 的问题。
- 微信开发者工具本地“校验合法域名”已开启。
- 桌面菜单模板工具支持多选模板、全选模板和一次批量导入多个菜单。

`/wxa/getuserriskrank` 属于额外的账号风险分级能力，本版本没有把它作为正常登录或发布的强制条件，避免个人维护账号因接口权限或风控结果被误锁。

## 已有服务器升级

先备份数据库、源码和图片目录，再依次执行已有迁移与 v2.9.0 迁移：

```bash
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.1.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.2.1.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.3.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.5.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.5.1.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.6.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.7.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.8.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.9.0.sql
npm ci --omit=dev
npm run migrate-menu-data
mkdir -p /opt/couple-space/data/avatars
mkdir -p /opt/couple-space/data/media
mkdir -p /opt/couple-space/data/pending-media
```

生产服务器 `.env` 需要保留或加入：

```dotenv
AVATAR_DIR=/opt/couple-space/data/avatars
MEDIA_DIR=/opt/couple-space/data/media
PENDING_MEDIA_DIR=/opt/couple-space/data/pending-media
PUBLIC_BASE_URL=https://czsdsg.cn
WECHAT_APP_ID=微信小程序AppID
WECHAT_APP_SECRET=仅保存在服务器的新AppSecret
WECHAT_MESSAGE_TOKEN=与微信消息推送配置一致的随机Token
```

微信密钥和 JSON 内容安全回调已经完成配置。常规部署不得重置密钥、修改回调格式或回显任何密钥；只有用户明确要求或验证发现配置失效时才处理微信平台配置。

Nginx 示例见 `server/nginx/couple-space.conf.example`。API 路由必须保留 `client_max_body_size 6m`；内容安全路径关闭访问日志，避免待审核图片的临时访问令牌进入日志。

## 验证

```bash
cd /opt/couple-space/server
npm ci --omit=dev
npm test
pm2 restart couple-space-api
pm2 save
curl -sS http://127.0.0.1:3001/api/couple-space/health
curl -sS https://czsdsg.cn/api/couple-space/health
```

健康接口的 `data.version` 应为 `2.9.0`，`data.contentSafety` 应为 `configured`。测试总数以当前源码实际输出为准，必须全部通过，不使用写死的历史数量代替结果。

部署完成后，先用新版小程序登录一次，再执行：

```bash
npm run check-content-security
```

该脚本不会写入业务数据，也不会打印 OpenID、AppSecret 或微信访问令牌。若提示没有最近登录的微信身份，先在新版小程序重新登录，再重试。

## 账号由管理员创建

个人主体小程序不提供用户自助注册。需要新增账号时，在服务器 `.env` 临时加入：

```dotenv
CREATE_USER_ACCOUNT=user_a
CREATE_USER_PASSWORD=至少8位的临时密码
CREATE_USER_NAME=用户昵称
CREATE_USER_GENDER=male
```

执行 `npm run create-user`，成功后立即删除全部 `CREATE_USER_*` 配置。数据库中只保存带随机盐的 `scrypt` 哈希，不要直接把明文密码写入 `users.password_hash`。

## 菜单与图片

- 菜单名称在同一情侣空间内唯一。
- 菜品做法文字会经过内容安全检测，说明图会经过异步图片审核。
- 制作说明图优先控制在约1.2MB，长边最高约2400像素，兼顾长图文字可读性与加载速度。
- 菜单做法保存后，新的点单会复制一份快照；历史订单不随菜单改动。
- 批量接口每次支持1至20个菜单，并在一个事务内全部成功或全部回滚。
- 桌面菜单工具可以按住 `Ctrl`/`Shift` 多选模板，或点击“全选模板”，再一次导入。
- 桌面工具最多并行审核3张图片，写入请求不会因网络超时而盲目重试。
- 小程序代码包不内置菜品照片；菜品图由用户选择后上传服务器，审核通过后跨设备共享。
- 头像优先控制在约420KB、菜品图约720KB、相册图约1.6MB；均保留原始宽高比。
- 头像、相册和菜品图片只有审核通过后才写入正式目录。
- 图片下载必须携带登录令牌，服务端还会校验 `couple_id`；其他情侣无法读取。
- 同一情侣空间两位成员读取同一份服务器图片，因此手机端和开发者工具可以同步看到。

## 安全边界

- 密码使用带随机盐的 `scrypt` 哈希。
- 会话令牌在数据库中只保存 SHA-256 哈希。
- MySQL 和 API 分别只监听 `127.0.0.1:3306`、`127.0.0.1:3001`。
- 文本检测失败、媒体检测失败或微信接口不可用时拒绝发布，不允许绕过。
- 待审核图片使用随机临时地址且限时有效，审核结束或超时后删除隔离文件。
- 公开注册接口和聊天接口继续返回404。
