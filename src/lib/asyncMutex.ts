/**
 * asyncMutex.ts — a keyed serialization queue (PR #140 review increment 2,
 * items 1/2/4 + item 14).
 *
 * Customer-account and vendor-payment mutations touch MULTIPLE documents
 * (a payment plus the invoices / cost item it settles), so a single-document
 * transaction cannot, on its own, serialize the read→validate→write against
 * over-allocation / overpayment. This mutex serializes those critical
 * sections per resource key (per clientId, or per cost item), guaranteeing
 * that the second concurrent request re-reads the first's committed state and
 * its pure validator (validateAllocations / validateVendorPayment) rejects the
 * excess. This gives real serialization in memory mode and within a single
 * server instance (item 14 — "serialized mutation mechanism"). Cross-instance
 * Firestore hardening additionally needs per-invoice / per-cost-item ledger
 * aggregates; see the increment notes.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  /** Run `fn` after any earlier task for `key` has settled; serialized per key. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((res) => { release = res; });
    // Our task becomes the new tail; the next caller waits on `mine`.
    this.tails.set(key, prior.then(() => mine));
    await prior.catch(() => { /* a prior task's failure must not block the queue */ });
    try {
      return await fn();
    } finally {
      release();
      // Best-effort cleanup so the map doesn't grow unbounded for idle keys.
      const current = this.tails.get(key);
      if (current) { current.then(() => { if (this.tails.get(key) === current) this.tails.delete(key); }).catch(() => {}); }
    }
  }
}
