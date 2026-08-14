import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqliteSpendLedger } from "../src/store/sqlite-spend-ledger.js";

describe("SqliteSpendLedger", () => {
  it("persists rolling spend across ledger instances on the same db", () => {
    const db = new DatabaseSync(":memory:");
    const first = new SqliteSpendLedger(db);
    expect(first.getSpentUsdMicrosLast24h()).toBe("0");
    first.recordSpend("1000");
    first.recordSpend("2500");
    expect(first.getSpentUsdMicrosLast24h()).toBe("3500");

    const second = new SqliteSpendLedger(db);
    expect(second.getSpentUsdMicrosLast24h()).toBe("3500");
    expect(second.tryReserveOperationSpend("held", "1000", "5000")).toBe("reserved");
    expect(second.getSpentUsdMicrosLast24h()).toBe("3500");
    expect(second.tryReserveOperationSpend("peer", "1000", "5000")).toBe("cap_exceeded");
    expect(second.ensureOperationSpend("held", "1000")).toBe(true);
    expect(second.getSpentUsdMicrosLast24h()).toBe("4500");
    db.close();
  });
});
