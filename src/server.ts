import app from "./app";
import { SessionState } from "./state/session";
// import type { ServerWebSocket } from "bun";

type WSData = {
  session: SessionState;
};

const server = Bun.serve<WSData>({
  port: 3000,

  fetch(req, server) {
   if (
  server.upgrade(req, {
    data: {
      session: new SessionState(),
    },
  })
) {
  return;
}

    return app.fetch(req);
  },

  websocket: {
    open(ws) {
      console.log("🟢 WebSocket connected");

      ws.data = {
        session: new SessionState(),
      };

      ws.data.session.set("LISTENING");

      ws.send(
        JSON.stringify({
          type: "state",
          value: "LISTENING",
        })
      );
    },

    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        console.log("📩 WS message:", data);
        console.log("Current state:", ws.data.session.state);
      } catch {
        console.warn("⚠️ Non-JSON WS message received");
      }
    },

    close(ws) {
      console.log("🔴 WebSocket disconnected");
    },
  },
});

console.log("🚀 Server running on http://localhost:3000");
