// relayIntegration.js
// Drop this into your existing MERN relay service (e.g. services/fraudCheck.js)
// and call `checkFraud()` right before you commit a decrypted packet
// for settlement.

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

// --- Example usage inside your existing settlement route/controller ---
//
// import { checkFraud } from "./services/fraudCheck.js";
//
// router.post("/relay/settle", async (req, res) => {
//   const packet = decryptPacket(req.body.encryptedPacket); // your existing crypto step
//
//   const fraudResult = await checkFraud({
//     senderId: packet.senderId,
//     receiverId: packet.receiverId,
//     amount: packet.amount,
//     timestamp: packet.timestamp,
//     relayDelaySeconds: (Date.now() - new Date(packet.createdAt)) / 1000,
//     packetSizeBytes: Buffer.byteLength(req.body.encryptedPacket),
//   });
//
//   if (fraudResult.isAnomalous) {
//     await PendingReview.create({ ...packet, fraudResult });
//     return res.status(202).json({
//       status: "pending_review",
//       reason: fraudResult.topContributingFeatures,
//     });
//   }
//
//   await settleTransaction(packet); // your existing settlement logic
//   return res.status(200).json({ status: "settled" });
// });
