// Every new load and navigation invalidates all previous asynchronous work.
export class SessionGate {
  private revision = 0;
  capture(): number { return this.revision; }
  next(): number { return ++this.revision; }
  current(token: number): boolean { return token === this.revision; }
}
