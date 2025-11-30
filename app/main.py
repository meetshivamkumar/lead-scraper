from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session

from . import models
from .database import engine, SessionLocal
from .schemas import LeadOut

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Shivortex Lead Scraper API")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/", tags=["Root"])
def root():
    return {"message": "Shivortex Lead Scraper API Running"}

@app.get("/leads", response_model=list[LeadOut])
def get_leads(db: Session = Depends(get_db)):
    return db.query(models.Lead).all()
