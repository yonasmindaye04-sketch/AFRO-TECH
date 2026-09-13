import pg from 'pg'
const pool = new pg.Pool({ host: 'localhost', port: 1818, database: 'afro_suite', user: 'postgres', password: 'Yo181801@///' })
const res = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'marketing%' ORDER BY table_name`)
console.log(res.rows.map(r => r.table_name).join('\n'))
await pool.end()
