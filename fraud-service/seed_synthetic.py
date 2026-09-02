"""
Seeds MongoDB with synthetic transactions: mostly "normal" patterns
plus a small injected fraction of anomalous ones (bursts, odd amounts,
fan-out to many receivers). This is for demo/training purposes only --
be upfront about this in your README, it's a normal practice for
portfolio projects without access to real fraud data.

Run:
    python seed_synthetic.py
"""
import os
import random
from datetime import datetime, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "upi_mesh")

SENDERS = [f"sender_{i}" for i in range(1, 21)]
RECEIVERS = [f"receiver_{i}" for i in range(1, 51)]


def normal_transaction(base_time, sender):
    return {
        "senderId": sender,
        "receiverId": random.choice(RECEIVERS),
        "amount": round(random.gauss(400, 150), 2),
        "timestamp": base_time.isoformat() + "Z",
        "relayDelaySeconds": round(random.uniform(2, 30), 1),
        "packetSizeBytes": random.randint(480, 560),
        "synthetic": True,
    }


def burst_fraud_pattern(base_time, sender):
    """Simulates a compromised sender firing rapid transactions to many receivers."""
    txns = []
    for i in range(6):
        txns.append({
            "senderId": sender,
            "receiverId": random.choice(RECEIVERS),
            "amount": round(random.uniform(2000, 5000), 2),
            "timestamp": (base_time + timedelta(seconds=i * 8)).isoformat() + "Z",
            "relayDelaySeconds": round(random.uniform(0.5, 3), 1),
            "packetSizeBytes": random.randint(480, 560),
            "synthetic": True,
        })
    return txns


def main():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]

    now = datetime.utcnow() - timedelta(days=15)
    rows = []

    for day in range(15):
        day_time = now + timedelta(days=day)
        for sender in SENDERS:
            for _ in range(random.randint(3, 8)):
                offset = timedelta(hours=random.uniform(0, 24))
                rows.append(normal_transaction(day_time + offset, sender))

        # inject ~2% fraud-pattern days
        if random.random() < 0.15:
            fraud_sender = random.choice(SENDERS)
            offset = timedelta(hours=random.uniform(0, 24))
            rows.extend(burst_fraud_pattern(day_time + offset, fraud_sender))

    rows.sort(key=lambda r: r["timestamp"])
    db.transactions.insert_many(rows)
    print(f"Inserted {len(rows)} synthetic transactions.")


if __name__ == "__main__":
    main()
