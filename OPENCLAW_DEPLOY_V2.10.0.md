# 情侣空间 v2.10.0 部署：经期记录

本次交付为服务端完整源码；小程序位于本地 `D:\wx_xiangm\qlcx\miniprogram`，由用户通过微信开发者工具发布。先部署服务端和数据库，再发布小程序，否则新增接口会返回 404。

## 0. 边界与前提

- 仅操作 `/opt/couple-space/server` 和 `couple_space` 数据库，不改动 spare-parts、Nginx 或已有微信配置。保留现有生产 `.env`，不得输出其中的值。
- 先读取当前 health 版本和核对数据库结构。已完成 v2.9.0 迁移的服务器只需本次 v2.10.0 SQL；仍为 v2.8.x 的服务器按第 2 步先补 v2.9.0。低于 v2.8.0 或版本/表结构不一致时暂停并汇报，不猜测迁移起点。
- 本次只增加两张表，不删除旧表、不重建业务数据。不要用 `schema.sql` 替代增量迁移。
- 同时更新依赖锁文件：MySQL2 修复版、`qs` 覆盖到 `6.16.0`，Express 仍为 4.x。必须同时更新 `package.json` 和 `package-lock.json`，不要沿用旧 `node_modules`。
- API 和 MySQL 仍只监听 `127.0.0.1`。不得记录经期日期、身体感受、请求体、密码或令牌到部署报告或应用日志。
- SQL、测试、健康检查任一失败即停止并报告具体失败阶段；不要靠改断言或测试数量来“通过”。测试总数以包内实际执行结果为准，要求 `fail: 0`。

## 1. 备份

备份现有源码和 `.env`、数据库、媒体目录，记录实际绝对路径。备份包含敏感信息，只留在服务器受限目录，不发到聊天或公开仓库。目录不存在时先核实真实媒体路径，不创建空备份冒充成功。

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

## 2. 更新源码与迁移

解压交付包，将其中 `server/` 更新到 `/opt/couple-space/server`。保留生产 `.env` 和原业务媒体；部署包不包含 `.env`、`node_modules` 或业务数据。安装依赖与 PM2 操作沿用当前服务用户，不扩大目录权限。

```bash
set -euo pipefail
cd /opt/couple-space/server
npm ci --omit=dev
```

如果确认服务器还是 v2.8.x，且尚未完成 v2.9.0 的规范化菜单迁移，使用本次已更新源码先执行以下补迁移；已完成者跳过此段。`menus.dishes` 兼容缓存和历史 `orders.dishes` 快照都保留，不能删除。不要照旧版说明重启并要求 health 为 2.9.0；本次最终运行版本统一为 2.10.0。

```bash
set -euo pipefail
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.9.0.sql
npm run migrate-menu-data
```

接着所有升级路径都执行本次新增迁移与测试：

```bash
set -euo pipefail
cd /opt/couple-space/server
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.10.0.sql
# 重复执行，确认增量建表脚本可重复运行。
mysql -h 127.0.0.1 -u couple_space -p couple_space < sql/migrate-v2.10.0.sql
mysql -h 127.0.0.1 -u couple_space -p couple_space -e 'SHOW CREATE TABLE period_settings; SHOW CREATE TABLE period_records;'
npm test
```

应有 `period_settings` 与 `period_records`，用户外键、共享情侣外键、用户/开始日期唯一索引及日期查询索引符合 SQL 文件。首次部署没有历史经期数据，无需导入测试记录或填充默认周期。`CREATE TABLE IF NOT EXISTS` 不会修正结构不一致的同名表；如已存在，须比对结构，不可将“未报错”等同于结构正确。

## 3. 重启与只读验证

```bash
set -euo pipefail
cd /opt/couple-space/server
pm2 restart couple-space-api
pm2 save
curl -fsS http://127.0.0.1:3001/api/couple-space/health
curl -fsS https://czsdsg.cn/api/couple-space/health
curl -sS -o /dev/null -w '%{http_code}\n' https://czsdsg.cn/api/couple-space/periods
```

内外网 health 必须为 200，`version` 为 `2.10.0`、`database` 为 `connected`。未登录请求 `/periods` 必须返回 401。保持公开注册返回 404，旧菜单、相册、订单接口及 spare-parts 服务正常。确认日志没有新异常，不复制任何用户健康内容。

## 4. 用户自测清单（不替用户创建真实健康记录）

由用户在小程序中使用测试账号执行；OpenClaw 无需索取真实经期信息：

1. 本人可保存开始/结束和历史记录；不能记录未来日期、倒置日期、重叠记录。相同开始日期重复提交不得生成两条。完整单条记录最大 90 天属于输入保护，不是健康判断。
2. 未绑定账号也可使用自己的记录。另一个账号默认看不到；尝试指定别人的 ID 修改/删除应返回 404，不改变对方数据。
3. 主动开启共享后，绑定伴侣只看日期、日历和估算，不看到经量、不适程度、身体感受，也没有修改入口。关闭共享后，伴侣下次刷新或重新进入应不可获取；已显示的屏幕内容无法远程抹去。
4. 无足够记录时不预测；已有预测逾期不自动顺延。共享统计仍是估算，不用于医疗或避孕。
5. 切换本人/伴侣、退出页面、换账号后，无之前账号记录残留；拉取失败有重试入口，不显示旧数据冒充新结果。
6. 小屏手机的日期选择、编辑弹层滚动、保存按钮和月历无错位；本地自动测试没有替代微信真机验收。

## 5. 回报与回滚

回报：实际备份路径、更新版本、两次增量迁移结果、两表结构检查、`npm test` 实际 total/pass/fail、PM2 状态、内外 health 状态码/版本、未登录 401、旧功能与 spare-parts 回归情况。未执行的项目明确写“未执行”，不要写全部通过。

本地交付已进行服务端 HTTP 模拟数据库与小程序逻辑测试，未连接生产 MySQL、未执行生产迁移，也未做微信真机测试。

如需回滚，停止新版更新，恢复备份服务端源码和原 `.env`，按原锁文件安装依赖后重启原服务；新增的两张表保留，不直接 DROP。若已产生新记录，禁止直接用旧数据库备份覆盖以免丢失；需由用户确认数据库恢复方案。新入口在旧服务下无法使用，应同时回退小程序版本或暂不发布新小程序。
