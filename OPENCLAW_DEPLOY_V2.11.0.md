# 情侣空间 v2.11.0 — OpenClaw 部署说明

本包为完整服务端源码（不是差异补丁），含新增相册收藏表的增量 SQL。小程序在用户本地 `D:\wx_xiangm\qlcx\miniprogram`，由用户通过微信开发者工具发布。务必先完成服务端和数据库升级，再发布小程序。

## 0. 操作边界与版本核对

- 只操作 `/opt/couple-space/server`、现有情侣空间媒体目录及 `couple_space` 数据库；不改 spare-parts、Nginx 和现有微信配置。
- 保留生产 `.env`、全部业务数据和已上传图片。不要把包里的 `.env.example` 替换成生产配置，不输出密钥、密码、令牌、邀请码或健康记录。
- 服务端版本必须变为 `2.11.0`；SQL、测试、健康检查任何一步失败即停止，报告真实错误，不修改断言或降低权限校验来放行。
- **测试数量以实际输出及包内 `release-manifest.json` 为依据，不写死 23、25 等旧数量。** 比清单多出的测试且全部通过不是失败；如与交付清单不一致，先核对文件哈希和执行范围，不直接修改测试。
- Node.js 最低 `20.9.0`。本次新增原生图像依赖 `sharp@0.35.4`，必须在服务器执行 `npm ci --omit=dev`；不得复制 Windows 的 node_modules。若现有 Node 不满足，先报告并确认运行时升级安排，不影响其他服务。
- 新版采用私有缩略图缓存：正式媒体目录下 `.thumbnails`，默认 `/opt/couple-space/data/media/.thumbnails`；按需生成、保留比例、原图不变。不要暴露静态目录，也不要访问待审核目录生成缩略图。

先读取内网 health 版本，记录当前源码目录、实际 `MEDIA_DIR`/`AVATAR_DIR`/`PENDING_MEDIA_DIR` 路径（只记录路径、不展示配置值）。核对数据库表结构与迁移起点：

| 当前版本 | 需执行的增量步骤 |
| --- | --- |
| v2.10.0 / v2.10.1 | 只执行 v2.11.0 SQL |
| v2.9.0 | v2.10.0 SQL，再 v2.11.0 SQL |
| v2.8.x | v2.9.0 SQL + 菜单数据迁移，再 v2.10.0、v2.11.0 SQL |
| 更旧 / 未知 / 结构不符 | 停止并报告，不猜测起点，不重跑全部 SQL |

`schema.sql` 仅用于全新空库，禁止用来覆盖已有数据库。

## 1. 完整备份与包校验

备份源码与生产 `.env`、现有全部媒体目录和数据库。备份包含隐私信息，权限应受限，不上传 GitHub 或发送到聊天。下面仅适用于媒体仍位于默认 `/opt/couple-space/data` 的情况；如自定义媒体路径，必须同时备份实际路径，不以空目录冒充备份。

```bash
set -euo pipefail
stamp=$(date +%Y%m%d-%H%M%S)
backup="/opt/couple-space/backup-$stamp"
install -d -m 700 "$backup"
cp -a /opt/couple-space/server "$backup/server"
cp -a /opt/couple-space/data "$backup/data"
mysqldump -h 127.0.0.1 -u couple_space -p --single-transaction couple_space > "$backup/couple_space.sql"
chmod 600 "$backup/couple_space.sql"
```

确认 ZIP 的 SHA256 与用户交付的一致。解压到受限临时目录，检查 `release-manifest.json` 的 version 为 2.11.0，并逐项核对文件哈希；包中不应有 `.env`、node_modules、业务媒体或数据库备份。完成后将 `server/` 内容更新到 `/opt/couple-space/server`，保留现有 `.env` 和媒体，沿用服务账号及目录权限。

## 2. 安装依赖与增量迁移

```bash
set -euo pipefail
cd /opt/couple-space/server
node --version
npm ci --omit=dev
node -e "require('sharp'); console.log('sharp loaded')"
```

只在确认尚未完成相应版本迁移时补执行下列前置步骤：

```bash
# 仅 v2.8.x 升级路径执行两行：
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.9.0.sql
npm run migrate-menu-data
# 仅尚无正确 period_settings / period_records 表的 v2.8.x / v2.9.0 路径：
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.10.0.sql
```

所有支持的升级路径执行本次迁移两次，以确认可重复运行：

```bash
set -euo pipefail
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.11.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.11.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space -e 'SHOW CREATE TABLE album_favorites;'
npm test
```

`album_favorites` 应为 InnoDB，主键 `(album_id,user_id)`，用户索引 `(user_id,album_id)`，分别关联 albums/users 并带删除级联。`CREATE TABLE IF NOT EXISTS` 不修复错误的同名表，必须比对实际结构。不会导入收藏、创建测试账号或伪造旧清单的完成日期。旧 `completed_at=NULL` 由时间线标记“完成时间未记录”。经期表及男女权限沿用 v2.10.1。

## 3. 重启与只读检查

```bash
set -euo pipefail
cd /opt/couple-space/server
pm2 restart couple-space-api
pm2 save
curl -fsS http://127.0.0.1:3001/api/couple-space/health
curl -fsS https://czsdsg.cn/api/couple-space/health
curl -sS -o /dev/null -w '%{http_code}\n' https://czsdsg.cn/api/couple-space/resources/albums/months
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://czsdsg.cn/api/couple-space/auth/register
```

- 内外 health 都应为 200，`version=2.11.0`、`database=connected`。
- 未登录访问相册、收藏、月份、经期和缩略图接口必须返回 401，公开注册仍为 404。
- PM2 服务 online，API/MySQL 仍仅回环监听；spare-parts 的现有服务保持正常。
- 脱敏检查日志无新异常；不要输出图片内容、身份标识、令牌、经期日期或用户请求体。

**本地自动测试使用模拟数据库。** 必须区分本地测试通过、服务器真实 SQL 执行通过、用户微信真机验收这三件事；未执行者明确写未执行。

## 4. 部署后用户自测清单

由用户使用现有测试账号测试，OpenClaw 不索取密码、不添加真实健康记录、不随意改生产订单。

1. 周菜单：快速切换两周，菜单不串周；未保存离开有提示；断网加载失败不能保存空周；重新生成采购保留已勾选食材和手动条目。
2. 采购来源：点击菜品来源可见正确食材、步骤图/文字；历史被删除的来源给出清楚提示。
3. 订单：双方接单、已做好、下单人确认完整走通；接单与修改/删除同时发生，受影响旧请求返回冲突，不能删改已接订单。翻页和各状态筛选正确。
4. 清单：完成后时间线显示真实完成时间，取消后移出完成记录；旧无完成时间显示说明；超过一页可继续加载，完成照片可跳转相册关联筛选。
5. 首页与导航：置顶不同年份/未来纪念日，标题日期天数一致；没有纪念日显示设置入口。三个底部入口都存在且选中正确，登录页不显示导航。
6. 相册：不同月份、我的收藏、清单关联筛选能组合；A 收藏不改变 B 的收藏；只显示当前情侣照片。退出登录/换账号不得残留上一账号数据。
7. 图片：多张上传显示各阶段，失败只重试未完成项；审核超时可继续查询，不重复新增已保存照片；审核拒绝不发布。缩略图按原比例，左右翻图加载当前原图、点图可放大，返回相册保留位置。
8. 私有缩略图：用授权测试会话请求已审核图片原图和 `?variant=thumbnail` 均成功；另一情侣账号返回 404、无令牌 401。响应不含公共地址，原图没有被覆盖；只删除无引用测试图片后对应派生缓存也删除。
9. 经期回归：女方自主共享，男方只读日期，不出现新增/修改/共享按钮；未设置身份先完善资料。不得将经期记录加入共同时间线。

## 5. 回报和回滚

回报实际备份绝对路径、升级前后版本、执行的每个 SQL、收藏表结构、测试实际 total/pass/fail、sharp 加载结果、PM2 状态、内外 health、401/404、旧功能和 spare-parts 是否受影响。不要按文档固定数字填“全部通过”。

回滚时先停止新版变更，恢复备份源码和 `.env`，按旧锁文件安装依赖、重启旧版服务；新增收藏表保留，不 DROP。缩略图缓存可以保留但不公开访问。若升级后有新数据，不允许直接用旧数据库备份覆盖；数据库恢复需另行确认。客户端也需同步回退，不能让新版收藏/分页客户端长时间连接旧接口。
