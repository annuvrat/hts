/**
 * Test script for STT (Speech-to-Text) functionality
 * 
 * This script connects to the WebSocket server and sends test audio data
 * to verify that the STT service is working correctly.
 * 
 * Usage:
 *   1. Make sure your server is running: bun run dev
 *   2. Run this test: bun run test-stt.ts
 *   3. Or use: GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json bun run test-stt.ts
 */

// Using Bun's native WebSocket (no need for ws package)

const WS_URL = "ws://localhost:3000";

// Generate a simple test audio signal (sine wave at 440Hz for 1 second)
// This creates PCM16 audio data at 16kHz sample rate
function generateTestAudio(durationSeconds: number = 1): Buffer {
  const sampleRate = 16000;
  const frequency = 440; // A4 note
  const samples = sampleRate * durationSeconds;
  const buffer = Buffer.allocUnsafe(samples * 2); // 2 bytes per sample (16-bit)

  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767 * 0.3))); // 30% volume
    buffer.writeInt16LE(intSample, i * 2);
  }

  return buffer;
}

// Generate silence (useful for testing)
function generateSilence(durationSeconds: number = 0.5): Buffer {
  const sampleRate = 16000;
  const samples = sampleRate * durationSeconds;
  return Buffer.alloc(samples * 2); // All zeros
}

async function testSTT() {
  console.log("🧪 Starting STT test...");
  console.log(`📡 Connecting to ${WS_URL}...`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      console.log("✅ WebSocket connected!");
      console.log("📤 Sending test audio data...");

      // Send a small chunk of silence first (helps with connection)
      const silence = generateSilence(0.1);
      ws.send(
        JSON.stringify({
          type: "audio_chunk",
          pcm: silence.toString("base64"),
        })
      );

      // Send test audio signal
      setTimeout(() => {
        const audio = generateTestAudio(1);
        ws.send(
          JSON.stringify({
            type: "audio_chunk",
            pcm: audio.toString("base64"),
          })
        );
        console.log("📤 Audio chunk sent (440Hz tone for 1 second)");
      }, 200);

      // Send more silence to help with finalization
      setTimeout(() => {
        const silence = generateSilence(0.5);
        ws.send(
          JSON.stringify({
            type: "audio_chunk",
            pcm: silence.toString("base64"),
          })
        );
        console.log("📤 Sent silence chunk to help finalize transcription");
      }, 1500);

      // Close after a delay
      setTimeout(() => {
        console.log("🔌 Closing connection...");
        ws.close();
        resolve();
      }, 3000);
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = event.data;
        const message = JSON.parse(
          typeof data === "string" ? data : data.toString()
        );
        console.log("📥 Received:", message);

        if (message.type === "partial_transcript") {
          console.log(`   ⏳ Partial: "${message.text}"`);
        } else if (message.type === "final_transcript") {
          console.log(`   ✅ Final: "${message.text}"`);
        } else if (message.type === "state") {
          console.log(`   🔄 State: ${message.value}`);
        }
      } catch (err) {
        console.error("❌ Error parsing message:", err);
      }
    });

    ws.addEventListener("error", (error) => {
      console.error("❌ WebSocket error:", error);
      reject(error);
    });

    ws.addEventListener("close", () => {
      console.log("🔴 WebSocket closed");
    });
  });
}

// Check if GOOGLE_APPLICATION_CREDENTIALS is set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn("⚠️  GOOGLE_APPLICATION_CREDENTIALS not set!");
  console.warn("   Set it with: export GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json");
  console.warn("   Or run: GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json bun run test-stt.ts");
  console.log("");
}

// Run the test
testSTT()
  .then(() => {
    console.log("\n✅ Test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });

