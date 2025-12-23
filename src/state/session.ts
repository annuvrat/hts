export type AgentState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING";

export class SessionState {
  state: AgentState = "IDLE";

  set(next: AgentState) {
    console.log(`🔄 State: ${this.state} → ${next}`);
    this.state = next;
  }

  is(expected: AgentState) {
    return this.state === expected;
  }
}
