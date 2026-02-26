import sqlite3
from app.db import engine
from sqlmodel import SQLModel
# Import all models so they are registered with SQLModel.metadata
from app.models import *

try:
    con = sqlite3.connect('data/app.db')
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    existing_tables = set(r[0] for r in cur.fetchall())
    
    expected_tables = set(SQLModel.metadata.tables.keys())
    
    missing_tables = expected_tables - existing_tables
    print("Missing tables:", missing_tables)
    
    if missing_tables:
        print("Creating missing tables...")
        SQLModel.metadata.create_all(engine)
        print("Done.")

except Exception as e:
    import traceback
    traceback.print_exc()
finally:
    con.close()
