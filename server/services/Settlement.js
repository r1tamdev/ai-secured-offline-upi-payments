import mongoose from "mongoose";
import User from "../models/user.js";
import Payment from "../models/payment.js";

export async function settle(instruction, packetHash, relayedBy = "anonymous") {
  const { nonce, sender, receiver, amount, note, signedAt } = instruction;

  let session = null;
  let useSession = true;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    useSession = false;
    console.warn("[Settlement] Running without session (no replica set)");
  }

  const opts = useSession ? { session } : {};

  try {
    const senderDoc = await User.findOne({ upiId: sender }, null, opts);
    if (!senderDoc) throw new Error(`Sender not found: ${sender}`);
    if (senderDoc.balance < amount) throw new Error("INSUFFICIENT_FUNDS");

    const receiverDoc = await User.findOne({ upiId: receiver }, null, opts);
    if (!receiverDoc) throw new Error(`Receiver not found: ${receiver}`);

    senderDoc.balance   = +(senderDoc.balance   - amount).toFixed(2);
    receiverDoc.balance = +(receiverDoc.balance  + amount).toFixed(2);

    await senderDoc.save(opts);
    await receiverDoc.save(opts);

    const [payment] = await Payment.create(
      [
        {
          packetHash,
          nonce,
          sender,
          receiver,
          amount,
          note,
          signedAt,
          status: "SETTLED",
          relayedBy,
          settledAt: new Date(),
        },
      ],
      opts,
    );

    if (useSession) await session.commitTransaction();
    return payment;
  } catch (err) {
    if (useSession && session) await session.abortTransaction();
    throw err;
  } finally {
    if (session) session.endSession();
  }
}