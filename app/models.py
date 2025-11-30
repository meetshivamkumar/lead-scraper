from sqlalchemy import Column, Integer, String, Float
from .database import Base

class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    category = Column(String)
    address = Column(String)
    city = Column(String)
    website = Column(String)
    phone = Column(String)
    email = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    source_url = Column(String)
