#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库迁移脚本：为User表添加密码和安全相关字段
使用方法：python migration_add_password.py
"""
import sqlite3
import bcrypt
from datetime import datetime
import sys
import io

# 设置标准输出编码为UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_PATH = "data/app.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 获取现有字段
    cursor.execute("PRAGMA table_info(user)")
    existing_columns = {col[1] for col in cursor.fetchall()}
    
    # 需要添加的字段列表
    new_fields = {
        "password_hash": "TEXT",
        "password_changed_at": "TIMESTAMP",
        "force_password_change": "INTEGER DEFAULT 0",
        "failed_login_attempts": "INTEGER DEFAULT 0",
        "locked_until": "TIMESTAMP"
    }
    
    # 添加缺失字段
    for field_name, field_type in new_fields.items():
        if field_name not in existing_columns:
            print(f"添加字段: {field_name}...")
            cursor.execute(f"ALTER TABLE user ADD COLUMN {field_name} {field_type}")
            conn.commit()
            print(f"✅ {field_name} 添加成功")
        else:
            print(f"⚠️  {field_name} 已存在，跳过")
    
    # 为ID=1的管理员设置默认密码（如果没有密码）
    cursor.execute("SELECT id, password_hash FROM user WHERE id = 1")
    admin = cursor.fetchone()
    
    if admin and not admin[1]:
        print("\n为初始管理员设置默认密码...")
        default_password = "admin123"
        password_hash = bcrypt.hashpw(default_password.encode(), bcrypt.gensalt()).decode()
        password_changed_at = datetime.utcnow().isoformat()
        
        cursor.execute(
            "UPDATE user SET password_hash = ?, password_changed_at = ? WHERE id = 1",
            (password_hash, password_changed_at)
        )
        conn.commit()
        
        print("✅ 默认密码设置成功")
        print(f"   用户名: admin（或查看employee_no字段）")
        print(f"   密码: {default_password}")
        print("   ⚠️  请登录后立即修改密码！")
    elif admin and admin[1]:
        print("⚠️  管理员已有密码，跳过")
    else:
        print("⚠️  未找到ID=1的管理员账号")
    
    conn.close()
    print("\n✅ 迁移完成")

if __name__ == "__main__":
    migrate()
