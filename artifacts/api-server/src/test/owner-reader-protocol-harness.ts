/** Local synthetic protocol harness only. Never point this at an application,
 * staging or Production server; there is deliberately no configurable remote URL. */
export class OwnerReaderProtocolHarness {
  private pending: Record<string, unknown> | null = null;
  constructor(private origin: string, private configuration: {
    endpointPath: string; deviceId: string; authenticationHeader: string; authenticationScheme: string;
  }, private credential: string) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
        url.pathname !== "/" || configuration.endpointPath !== "/api/v1/owner-reader/uid-events" ||
        configuration.authenticationHeader !== "Authorization" || configuration.authenticationScheme !== "Bearer") {
      throw Error("Owner protocol harness requires an isolated loopback fixture and the exact Owner auth contract");
    }
  }
  loadCredential(credential: string) { this.credential = credential; }
  enqueue(eventId: string, eventType: "CARD_SCAN" | "READER_HEARTBEAT", uid?: string) {
    if (this.pending) throw Error("Reconcile the retained report before queueing another fixture event");
    this.pending = { event_id: eventId, device_id: this.configuration.deviceId,
      event_type: eventType, timestamp: new Date().toISOString(), ...(uid ? { uid } : {}) };
  }
  retainedEvent() { return this.pending ? { ...this.pending } : null; }
  async deliver() {
    if (!this.pending) throw Error("No pending fixture event");
    const response = await fetch(`${this.origin}${this.configuration.endpointPath}`, {
      method: "POST", headers: { "Content-Type": "application/json",
        [this.configuration.authenticationHeader]: `${this.configuration.authenticationScheme} ${this.credential}` },
      body: JSON.stringify(this.pending),
    });
    const body = await response.json() as Record<string, unknown>;
    if (response.ok && body.success === true) this.pending = null;
    return { status: response.status, body };
  }
}
