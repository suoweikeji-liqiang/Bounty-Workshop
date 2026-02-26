import sqlite3

def upgrade():
    try:
        con = sqlite3.connect('data/app.db')
        cur = con.cursor()
        cur.execute("ALTER TABLE problem ADD COLUMN analysis_id INTEGER;")
        cur.execute("ALTER TABLE problem ADD COLUMN analysis_status VARCHAR DEFAULT 'PENDING';")
        con.commit()
        print("Success: Columns added.")
    except Exception as e:
        print("Error:", e)
    finally:
        con.close()

if __name__ == '__main__':
    upgrade()
