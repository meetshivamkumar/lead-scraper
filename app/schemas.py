from pydantic import BaseModel

class LeadBase(BaseModel):
    name: str | None = None
    category: str | None = None
    address: str | None = None
    city: str | None = None
    website: str | None = None
    phone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    source_url: str | None = None

class LeadOut(LeadBase):
    id: int

    class Config:
        orm_mode = True
