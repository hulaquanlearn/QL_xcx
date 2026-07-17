const mysql = require('mysql2/promise');
const config = require('./config');
const pool = mysql.createPool({ ...config.mysql, waitForConnections: true, queueLimit: 0, enableKeepAlive: true });
module.exports = { pool, checkDatabase: () => pool.query('SELECT 1') };
