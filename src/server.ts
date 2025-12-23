import app from "./app";
import { SessionState } from "./state/session";
import { createStreamingSTT } from "./services/stt/google.stt";
import { streamGemini } from "./services/llm/llm";
import { createElevenLabsTTS } from "./services/tts/eleven";

type WSData = {
  session: SessionState;
  stt?: ReturnType<typeof createStreamingSTT>;
  tts?: ReturnType<typeof createElevenLabsTTS>;
  finalTranscript?: string;
  silenceTimer?: Timer;
  ttsStarted?: boolean;
  speakingAt?: number;
  ttsFinished?: boolean;
  vertexAIFinished?: boolean;
  fillerCompleted?: boolean;
  tokenBuffer?: string;
  tokenBufferTimer?: Timer;
  interruptTranscript?: string;
  tokensReceived?: number; // Track total tokens received
  tokensSent?: number; // Track total tokens sent to TTS
};

const SILENCE_THRESHOLD_MS = 300; // Reduced for faster response

const fillers = [
  "Alright, let me think about that. ",
  "Good question — here’s how I see it. ",
  "Yeah, so here’s the thing. ",
  "Okay, let’s break this down. ",
];

const server = Bun.serve<WSData>({
  port: 3000,

  fetch(req, server) {
    if (
      server.upgrade(req, {
        data: {
          session: new SessionState(),
        },
      })
    ) return;

    return app.fetch(req);
  },

  websocket: {
    open(ws) {
      console.log("🟢 WebSocket connected");
      ws.data.session.set("LISTENING");

      ws.data.stt = createStreamingSTT(
        () => resetSilenceTimer(ws),
        (finalText) => {
          // If agent is speaking, this might be an interruption
          if (ws.data.session.is("SPEAKING")) {
            // Only interrupt if we get meaningful speech (not just noise/echo)
            // Check if transcript is substantial enough to be real speech
            const cleanText = finalText.trim().toLowerCase();
            const isMeaningful = cleanText.length > 3 && 
                                 !cleanText.match(/^(uh|um|ah|hmm|like|yeah|okay)$/i);
            
            if (isMeaningful) {
              console.log("⛔ User interrupted agent:", finalText);
              // Interrupt immediately for responsive experience
              ws.data.tts?.close();
              ws.data.tts = undefined;
              ws.data.tokenBuffer = undefined;
              ws.data.tokenBufferTimer && clearTimeout(ws.data.tokenBufferTimer);
              ws.data.vertexAIFinished = false;
              ws.data.ttsFinished = false;
              ws.data.session.set("LISTENING");
              ws.data.finalTranscript = finalText; // Use this as the new input
              ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
              resetSilenceTimer(ws);
            } else {
              console.log("🔇 Ignoring short/noise transcript during speech:", finalText);
            }
          } else {
            ws.data.finalTranscript = finalText;
            resetSilenceTimer(ws);
          }
        }
      );

      ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
    },

    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "audio_chunk" && ws.data.stt) {
          // Process audio even while speaking - we'll detect interruption via final transcripts
          // This allows proper interruption detection like ChatGPT
          ws.data.stt.write(Buffer.from(data.pcm, "base64"));
        }
      } catch (e) {
        console.warn("⚠️ Invalid WS message", e);
      }
    },

    close(ws) {
      ws.data.silenceTimer && clearTimeout(ws.data.silenceTimer);
      ws.data.stt?.close();
      ws.data.tts?.close();
      console.log("🔴 WebSocket disconnected");
    },
  },
});

console.log("🚀 Server running on http://localhost:3000");

/* ---------------- HELPERS ---------------- */

function resetSilenceTimer(ws: Bun.ServerWebSocket<WSData>) {
  if (ws.data.silenceTimer) clearTimeout(ws.data.silenceTimer);

  ws.data.silenceTimer = setTimeout(() => {
    if (ws.data.session.is("LISTENING") && ws.data.finalTranscript) {
      ws.data.session.set("SPEAKING");
      ws.data.speakingAt = Date.now();
      ws.send(JSON.stringify({ type: "state", value: "SPEAKING" }));
      handleTurn(ws);
    }
  }, SILENCE_THRESHOLD_MS);
}

async function handleTurn(ws: Bun.ServerWebSocket<WSData>) {
  const userText = ws.data.finalTranscript;
  ws.data.finalTranscript = undefined;
  if (!userText) {
    console.warn("⚠️ handleTurn called but no user text");
    return;
  }

  console.log("🧠 User:", userText);

  try {
    ws.data.ttsStarted = false;
    ws.data.ttsFinished = false;
    ws.data.vertexAIFinished = false;
    ws.data.tokensReceived = 0;
    ws.data.tokensSent = 0;

    console.log("🎙️ Initializing TTS...");
    ws.data.fillerCompleted = false;
    ws.data.tokenBuffer = "";
    
    ws.data.tts = createElevenLabsTTS(
      (audioChunk) => {
        if (!ws.data.ttsStarted) {
          ws.data.ttsStarted = true;
          console.log("🎙️ TTS started - first audio chunk received");
        }

        ws.send(JSON.stringify({
          type: "agent_audio",
          audio: audioChunk.toString("base64"),
        }));
      },
      () => {
        // Callback when TTS is finished generating a chunk
        // If this is the filler completing, mark it
        if (!ws.data.fillerCompleted && ws.data.ttsStarted) {
          ws.data.fillerCompleted = true;
          console.log("✅ Filler text completed, ready for AI response");
        }
      },
      () => {
        // Callback when TTS is completely finished
        ws.data.ttsFinished = true;
        console.log("✅ TTS finished generating all audio");
        checkAndCompleteTurn(ws);
      }
    );

    // 🔥 Send filler and start AI immediately (parallel) for lower latency
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    console.log(`💬 Sending filler: "${filler}"`);
    ws.data.tts.sendText(filler);

    // Start Vertex AI immediately - don't wait for filler (reduces latency)
    // Filler will play while AI is generating, creating smooth transition
    console.log("🤖 Starting Vertex AI stream immediately...");
    startVertexAI(ws, userText);
  } catch (error) {
    console.error("❌ Error in handleTurn:", error);
    ws.data.tts?.close();
    ws.data.tts = undefined;
    ws.data.session.set("LISTENING");
    ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
  }
}

function startVertexAI(ws: Bun.ServerWebSocket<WSData>, userText: string) {
  console.log("🤖 Starting Vertex AI stream...");
  streamGemini(userText, (token) => {
    // Check if we're still in SPEAKING state and TTS is still active
    if (ws.data.session.is("SPEAKING") && ws.data.tts) {
      ws.data.tokensReceived = (ws.data.tokensReceived || 0) + 1;
      
      // Accumulate tokens in buffer
      ws.data.tokenBuffer = (ws.data.tokenBuffer || "") + token;
      
      // Clear existing timer
      if (ws.data.tokenBufferTimer) {
        clearTimeout(ws.data.tokenBufferTimer);
      }
      
      // Check if we should flush immediately (sentence endings or buffer getting large)
      const bufferLength = ws.data.tokenBuffer.length;
      const hasSentenceEnd = /[.!?]\s*$/.test(ws.data.tokenBuffer.trim());
      const bufferFull = bufferLength > 30; // Flush if buffer gets too large (prevents token loss)
      
      if ((hasSentenceEnd || bufferFull) && ws.data.session.is("SPEAKING") && ws.data.tts) {
        // Send immediately on sentence endings or when buffer is full
        const toSend = ws.data.tokenBuffer;
        ws.data.tokenBuffer = "";
        ws.data.tokensSent = (ws.data.tokensSent || 0) + toSend.length;
        ws.data.tts.sendText(toSend);
      } else {
        // Otherwise buffer for a short time for smoother delivery
        ws.data.tokenBufferTimer = setTimeout(() => {
          if (ws.data.tokenBuffer && ws.data.session.is("SPEAKING") && ws.data.tts) {
            const toSend = ws.data.tokenBuffer;
            ws.data.tokenBuffer = "";
            ws.data.tokensSent = (ws.data.tokensSent || 0) + toSend.length;
            ws.data.tts.sendText(toSend);
          }
        }, 30); // 30ms buffer - very short for low latency, still smooth enough
      }
    } else {
      console.warn("⚠️ Received token but session is not SPEAKING or TTS closed, ignoring");
    }
  }).then(() => {
    console.log("✅ Vertex AI stream completed");
    ws.data.vertexAIFinished = true;
    
    // Flush any remaining buffered tokens immediately (CRITICAL - don't lose tokens!)
    if (ws.data.tokenBuffer && ws.data.tokenBuffer.trim() && ws.data.tts && ws.data.session.is("SPEAKING")) {
      ws.data.tokensSent = (ws.data.tokensSent || 0) + ws.data.tokenBuffer.length;
      ws.data.tts.sendText(ws.data.tokenBuffer);
      ws.data.tokenBuffer = "";
      console.log(`📤 Flushed remaining token buffer`);
    }
    
    console.log(`📊 Token stats: Received ${ws.data.tokensReceived || 0} tokens, Sent ${ws.data.tokensSent || 0} chars to TTS`);
    
    // Clear buffer timer
    if (ws.data.tokenBufferTimer) {
      clearTimeout(ws.data.tokenBufferTimer);
      ws.data.tokenBufferTimer = undefined;
    }
    
    // Send empty text to flush TTS and signal end of input
    if (ws.data.tts) {
      ws.data.tts.sendText("");
      console.log("📤 Sent flush signal to TTS");
    }
    
    checkAndCompleteTurn(ws);
  }).catch((error) => {
    console.error("❌ Vertex AI error:", error);
    ws.data.vertexAIFinished = true;
    checkAndCompleteTurn(ws);
  });
}

function checkAndCompleteTurn(ws: Bun.ServerWebSocket<WSData>) {
  // Only complete if both are done and we're still speaking
  if (ws.data.vertexAIFinished && ws.data.ttsFinished && ws.data.session.is("SPEAKING")) {
    console.log("🔒 Both Vertex AI and TTS finished, closing...");
    ws.data.tts?.close();
    ws.data.tts = undefined;

    // Small delay to ensure all audio is sent to client
    setTimeout(() => {
      ws.data.session.set("LISTENING");
      ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
      console.log("✅ Turn completed, back to LISTENING");
    }, 500);
  } else if (ws.data.vertexAIFinished && !ws.data.ttsFinished) {
    // Vertex AI done but TTS still generating - wait for it
    console.log("⏳ Vertex AI done, waiting for TTS to finish...");
    // Set a timeout in case isFinal never comes (fallback after 5 seconds)
    setTimeout(() => {
      if (!ws.data.ttsFinished && ws.data.session.is("SPEAKING")) {
        console.log("⏰ Timeout waiting for TTS isFinal, completing anyway...");
        ws.data.ttsFinished = true;
        checkAndCompleteTurn(ws);
      }
    }, 5000);
  }
}
