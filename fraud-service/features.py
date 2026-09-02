"""
Feature engineering for UPI Offline Mesh transactions.

Design note: these features are chosen because they're all derivable
from data your relay ALREADY has (packet metadata, timestamps, sender
history) -- no new instrumentation needed on the offline/device side.
"""
from datetime import datetime, timedelta


def extract_features(transaction: dict, sender_history: list[dict]) -> dict:
    """
    transaction: the incoming packet's decrypted metadata, e.g.
        {
          "senderId": "...",
          "receiverId": "...",
          "amount": 450.0,
          "timestamp": "2026-08-30T10:15:00Z",
          "relayDelaySeconds": 12.4,   # time between packet creation and relay pickup
          "packetSizeBytes": 512
        }
    sender_history: list of the sender's past N transactions (from MongoDB),
        each with the same shape as `transaction`.

    Returns a flat dict of numeric features -- this is what gets fed to
    the Isolation Forest, and also what gets logged for explainability.
    """
    amount = transaction["amount"]
    ts = datetime.fromisoformat(transaction["timestamp"].replace("Z", "+00:00"))

    # --- amount deviation ---
    past_amounts = [t["amount"] for t in sender_history]
    avg_amount = sum(past_amounts) / len(past_amounts) if past_amounts else amount
    amount_ratio = amount / avg_amount if avg_amount > 0 else 1.0

    # --- velocity: how many txns from this sender in the last 5 minutes ---
    window_start = ts - timedelta(minutes=5)
    recent_count = sum(
        1 for t in sender_history
        if datetime.fromisoformat(t["timestamp"].replace("Z", "+00:00")) >= window_start
    )

    # --- distinct receivers in last 5 minutes (fan-out pattern) ---
    recent_receivers = {
        t["receiverId"] for t in sender_history
        if datetime.fromisoformat(t["timestamp"].replace("Z", "+00:00")) >= window_start
    }

    # --- time-of-day (cyclical encoding avoids the 23h/0h discontinuity) ---
    hour = ts.hour + ts.minute / 60.0

    return {
        "amount": amount,
        "amount_ratio_to_avg": round(amount_ratio, 3),
        "velocity_5min": recent_count,
        "distinct_receivers_5min": len(recent_receivers),
        "relay_delay_seconds": transaction.get("relayDelaySeconds", 0.0),
        "packet_size_bytes": transaction.get("packetSizeBytes", 0),
        "hour_of_day": round(hour, 2),
    }


FEATURE_ORDER = [
    "amount",
    "amount_ratio_to_avg",
    "velocity_5min",
    "distinct_receivers_5min",
    "relay_delay_seconds",
    "packet_size_bytes",
    "hour_of_day",
]


def to_vector(features: dict) -> list[float]:
    """Deterministic ordering for feeding the model."""
    return [features[k] for k in FEATURE_ORDER]
