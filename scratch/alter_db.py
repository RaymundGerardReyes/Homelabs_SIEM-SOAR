import asyncio
import asyncpg
import sys

async def main():
    try:
        conn = await asyncpg.connect("postgresql://soc_admin:soc_secure_password_2026@localhost:5432/soc_db")
        await conn.execute("ALTER TABLE endpoint_inventory ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);")
        print("Successfully added ip_address column to endpoint_inventory")
        await conn.close()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
