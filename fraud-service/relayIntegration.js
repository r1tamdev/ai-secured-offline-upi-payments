import axios from "axios";

const FRAUD_SERVICE_URL = process.env.FRAUD_SERVICE_URL || "http://localhost:8001";

/**
 * @param {Object} txn - decrypted packet metadata
 * @param {string} txn.senderId
 * @param {string} txn.receiverId
 * @param {number} txn.amount
 * @param {string} txn.timestamp     ISO 8601 string
 * @param {number} txn.relayDelaySeconds
 * @param {number} txn.packetSizeBytes
 * @returns {Promise<{isAnomalous: boolean, anomalyScore: number, topContributingFeatures: string[]}>}
 */
export async function checkFraud(txn) {
  try {
    const { data } = await axios.post(`${FRAUD_SERVICE_URL}/score`, txn, {
      timeout: 3000, // fail fast -- don't let scoring stall settlement
    });
    return data;
  } catch (err) {
    // Fraud service being down should NOT block legitimate settlement.
    // Fail open, but log loudly so you notice in the demo/logs.
    console.error("[fraudCheck] scoring service unreachable, failing open:", err.message);
    return { isAnomalous: false, anomalyScore: null, topContributingFeatures: [] };
  }
}
