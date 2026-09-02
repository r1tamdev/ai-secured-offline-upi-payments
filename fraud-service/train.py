"""
Trains the Isolation Forest on recent transaction history from MongoDB.

Run manually or via a cron job / scheduled task:
    python train.py

Why Isolation Forest:
  - No labeled fraud data exists for a personal project, so this must
    be unsupervised.
  - It isolates anomalies by random recursive partitioning -- outliers
    need fewer splits to isolate, which gives an anomaly score without
    assuming any particular data distribution (unlike z-score methods).
  - Cheap to train, cheap to run at inference time -- fits the
    "scoring happens at the relay gateway, not on-device" constraint.
"""
import os
import pickle
from datetime import datetime, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient
from sklearn.ensemble import IsolationForest

from features import extract_features, to_vector

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "upi_mesh")
LOOKBACK_DAYS = int(os.getenv("TRAIN_LOOKBACK_DAYS", "30"))
MODEL_PATH = os.getenv("MODEL_PATH", "model.pkl")

# Contamination = expected fraction of anomalies in training data.
# Start low (real fraud is rare) and tune based on how many false
# positives show up in your `pending_review` queue.
CONTAMINATION = float(os.getenv("CONTAMINATION", "0.02"))


def build_training_set(db):
    cutoff = datetime.utcnow() - timedelta(days=LOOKBACK_DAYS)
    txns = list(
        db.transactions.find({"timestamp": {"$gte": cutoff.isoformat() + "Z"}})
        .sort("timestamp", 1)
    )

    rows = []
    # Group by sender so each transaction's history only includes
    # that sender's prior transactions (avoids leaking future data).
    history_by_sender: dict[str, list[dict]] = {}
    for txn in txns:
        sender = txn["senderId"]
        history = history_by_sender.get(sender, [])
        feats = extract_features(txn, history)
        rows.append(to_vector(feats))
        history_by_sender.setdefault(sender, []).append(txn)

    return rows


def main():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]

    rows = build_training_set(db)
    if len(rows) < 20:
        print(f"Only {len(rows)} transactions found -- too few to train on.")
        print("Seed synthetic data first (see seed_synthetic.py) or wait for more volume.")
        return

    model = IsolationForest(
        n_estimators=200,
        contamination=CONTAMINATION,
        random_state=42,
    )
    model.fit(rows)

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

    print(f"Trained on {len(rows)} transactions. Model saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
