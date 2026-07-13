/**
 * firestoreSnapshotAdapter.ts
 *
 * The Firebase Admin SDK's DocumentSnapshot exposes `exists` as a boolean
 * property, while the client SDK (and this codebase's memory-fallback
 * snapshots — see handleGetDocMemory in server.ts) expose it as a callable
 * `exists()`. Every existing call site in server.ts was written against the
 * client-SDK/memory-fallback shape (`if (snap.exists())`), so migrating
 * server.ts's live Firestore path to the Admin SDK needs this adapter at
 * the one boundary where a raw Admin SDK DocumentSnapshot is turned into
 * the shape the rest of the file already expects — not a rewrite of every
 * call site.
 */
export interface RawAdminDocSnapshot {
  exists: boolean;
  data: () => any;
  id: string;
  ref: any;
}

export interface AdaptedDocSnapshot {
  exists: () => boolean;
  data: () => any;
  id: string;
  ref: any;
}

export function adaptDocSnapshot(snap: RawAdminDocSnapshot): AdaptedDocSnapshot {
  return {
    exists: () => snap.exists,
    data: () => snap.data(),
    id: snap.id,
    ref: snap.ref,
  };
}
