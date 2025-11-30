# Shivortex — Lead Scraper (MVP)

Purpose: Budget-friendly lead scraper MVP to collect high-quality business leads (category/city/rating), enrich data (website, phone, lat/long, guessed email patterns), store in DB and expose a simple API.

Stack (MVP):
- Scraper: Scrapy / Playwright (Python)
- Backend: FastAPI
- DB: SQLite (initial)
- Frontend: exported static from Webflow/Bubble (calls API)
- Hosting: Vercel / Render (free tiers)

Quick start:
1. Create & activate Python venv
2. `pip install -r requirements.txt`
3. Run scraper or `uvicorn app.main:app --reload`
