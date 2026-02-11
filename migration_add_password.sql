-- 添加密码字段到User表
-- 执行方式: sqlite3 data/app.db < migration_add_password.sql

ALTER TABLE user ADD COLUMN password_hash TEXT;

-- 为初始管理员设置密码（admin123）
-- 注意：需要在Python代码中执行bcrypt哈希
