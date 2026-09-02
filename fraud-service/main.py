"""
Fraud-scoring microservice for UPI Offline Mesh.

Runs alongside your Node/Express relay. The relay calls POST /score
right before committing a decrypted packet for settlement.

Run:
    uvicorn main:app --reload --port 8001
"""
import os
import pickle
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel
from pymongo import MongoClient

from features import extract_features, to_vector, FEATURE_ORDER

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "upi_mesh")
MODEL_PATH = os.getenv("MODEL_PATH", "model.pkl")
FLAG_THRESHOLD = float(os.getenv("FLAG_THRESHOLD", "0.0"))
# Isolation Forest's decision_function: negative-ish = more anomalous,
# positive-ish = more normal. 0.0 is a reasonable starting cutoff --
# tune this based on your pending_review false-positive rate.

app = FastAPI(title="UPI Mesh Fraud Scoring")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

_model = None


def get_model():
    global _model
    if _model is None:
        with open(MODEL_PATH, "rb") as f:
            _model = pickle.load(f)
    return _model


class Transaction(BaseModel):
    senderId: str
    receiverId: str
    amount: float
    timestamp: str  # ISO 8601, e.g. "2026-08-30T10:15:00Z"
    relayDelaySeconds: float = 0.0
    packetSizeBytes: int = 0


class ScoreResponse(BaseModel):
    isAnomalous: bool
    anomalyScore: float
    topContributingFeatures: list[str]
    features: dict


@app.post("/score", response_model=ScoreResponse)
def score_transaction(txn: Transaction):
    sender_history = list(
        db.transactions.find({"senderId": txn.senderId})
        .sort("timestamp", -1)
        .limit(50)
    )

    feats = extract_features(txn.model_dump(), sender_history)
    vector = to_vector(feats)

    model = get_model()
    # decision_function: higher = more normal, lower/negative = more anomalous
    raw_score = model.decision_function([vector])[0]
    is_anomalous = raw_score < FLAG_THRESHOLD

    # Simple explainability layer: flag which features are most extreme
    # relative to typical ranges. This is a heuristic, not derived from
    # the model internals -- Isolation Forest doesn't give per-feature
    # attribution natively, so this is what makes the flag defensible
    # in a demo/interview rather than a black-box "trust me" score.
    contributing = []
    if feats["amount_ratio_to_avg"] > 3:
        contributing.append(f"amount {feats['amount_ratio_to_avg']}x sender's average")
    if feats["velocity_5min"] >= 4:
        contributing.append(f"{feats['velocity_5min']} transactions in last 5 min")
    if feats["distinct_receivers_5min"] >= 4:
        contributing.append(f"fan-out to {feats['distinct_receivers_5min']} receivers in 5 min")
    if feats["relay_delay_seconds"] < 1:
        contributing.append("unusually fast relay pickup")

    result = ScoreResponse(
        isAnomalous=bool(is_anomalous),
        anomalyScore=round(float(raw_score), 4),
        topContributingFeatures=contributing,
        features=feats,
    )

    # Log every scored transaction (not just flagged ones) -- this is
    # also what feeds future retraining.
    db.transactions.insert_one({
        **txn.model_dump(),
        "anomalyScore": result.anomalyScore,
        "isAnomalous": result.isAnomalous,
        "scoredAt": datetime.utcnow().isoformat() + "Z",
    })

    return result


@app.get("/health")
def health():
    return {"status": "ok", "modelLoaded": _model is not None}
