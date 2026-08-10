const { checkText, isConfigured } = require('../src/content-safety');
const { pool } = require('../src/db');

async function main() {
  if (!isConfigured()) throw new Error('WECHAT_APP_ID 或 WECHAT_APP_SECRET 未配置');
  const [rows] = await pool.query(
    `SELECT wechat_openid FROM sessions
     WHERE wechat_openid IS NOT NULL
       AND wechat_seen_at>DATE_SUB(NOW(),INTERVAL 2 HOUR)
     ORDER BY wechat_seen_at DESC LIMIT 1`
  );
  if (!rows[0]?.wechat_openid) {
    throw new Error('没有两小时内访问过小程序的有效会话，请先打开新版小程序并登录');
  }
  await checkText('内容安全接口连通性测试', {
    openid: rows[0].wechat_openid,
    scene: 4
  });
  process.stdout.write('content security check: ok\n');
}

main().catch(error => {
  const code = error.wechatCode ? `, wechat code ${error.wechatCode}` : '';
  process.stderr.write(`content security check: failed (${error.message}${code})\n`);
  process.exitCode = 1;
}).finally(() => pool.end());
