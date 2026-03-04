export interface FirestoreService {
  ping(): Promise<"ok">
}

export function createFirestoreService(): FirestoreService {
  return {
    async ping() {
      return "ok"
    }
  }
}
