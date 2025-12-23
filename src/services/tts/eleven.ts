// Check for required environment variables
if (!process.env.ELEVENLABS_API_KEY) {
  console.error("❌ ELEVENLABS_API_KEY environment variable is not set!");
  console.error("   Set it with: export ELEVENLABS_API_KEY=your-api-key");
}

if (!process.env.ELEVENLABS_VOICE_ID) {
  console.error("❌ ELEVENLABS_VOICE_ID environment variable is not set!");
  console.error("   Set it with: export ELEVENLABS_VOICE_ID=your-voice-id");
}

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;

export function createElevenLabsTTS(
  onAudioChunk: (chunk: Buffer) => void,
  onChunkComplete?: () => void, // Called when a chunk completes (for filler detection)
  onFinished?: () => void // Called when all generation is complete
) {
  console.log("🎙️ Creating ElevenLabs TTS connection...");
  
  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_monolingual_v1`,
    {
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
      },
    } as any
  );

  let isOpen = false;
  let closed = false;
  const queue: string[] = [];
  let audioChunkCount = 0;

  ws.onopen = () => {
    isOpen = true;
    console.log("✅ ElevenLabs TTS WebSocket connected");

    // Send initial voice settings (required for streaming API)
    // This must be sent first, before any text
    // Using smaller chunk sizes for faster response
    const initialConfig = {
      text: " ",
      voice_settings: {
        stability: 0.6, // Slightly higher for smoother voice
        similarity_boost: 0.8, // Higher for better voice quality
      },
      generation_config: {
        chunk_length_schedule: [60, 100, 150, 200], // Balanced for fast start + smooth delivery
      },
    };
    console.log("📤 Sending initial config to ElevenLabs:", JSON.stringify(initialConfig));
    ws.send(JSON.stringify(initialConfig));

    // Minimal delay to ensure config is processed - send immediately
    // Flush queued text right away (config should be processed by now)
    if (queue.length > 0) {
      console.log(`📤 Flushing ${queue.length} queued text messages immediately`);
      for (const text of queue) {
        ws.send(JSON.stringify({ text, try_trigger_generation: true }));
      }
      queue.length = 0;
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = typeof event.data === 'string' ? event.data : event.data.toString();
      const msg = JSON.parse(data);
      
      if (msg.audio) {
        audioChunkCount++;
        const audioBuffer = Buffer.from(msg.audio, "base64");
        if (audioChunkCount <= 3 || audioChunkCount % 10 === 0) {
          console.log(`🔊 ElevenLabs audio chunk ${audioChunkCount}: ${audioBuffer.length} bytes`);
        }
        onAudioChunk(audioBuffer);
        // Notify that a chunk completed (useful for filler detection)
        if (onChunkComplete && audioChunkCount === 1) {
          onChunkComplete();
        }
      } else if (msg.error) {
        console.error("❌ ElevenLabs error:", msg.error);
      } else if (msg.isFinal !== undefined) {
        console.log("✅ ElevenLabs generation complete (isFinal:", msg.isFinal, ")");
        if (msg.isFinal && onFinished) {
          // Small delay to ensure all audio chunks are processed
          setTimeout(() => {
            onFinished();
          }, 300);
        }
      }
      // Reduced logging for non-audio messages
    } catch (error) {
      console.error("❌ Error parsing ElevenLabs message:", error);
    }
  };

  ws.onerror = (err) => {
    console.error("❌ ElevenLabs WebSocket error:", err);
  };

  ws.onclose = (event) => {
    closed = true;
    console.log(`🔚 ElevenLabs WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
  };

  function sendText(text: string) {
    if (closed) {
      console.warn("⚠️ Attempted to send text to closed TTS connection");
      return;
    }

    if (!isOpen) {
      console.log(`📝 Queueing text (${text.length} chars): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      queue.push(text);
      return;
    }

    // Reduced logging - only log first few and periodic sends
    if (queue.length === 0) {
      console.log(`📤 Sending text to ElevenLabs (${text.length} chars): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
    // Always use try_trigger_generation: true for faster streaming
    ws.send(JSON.stringify({
      text,
      try_trigger_generation: true,
    }));
  }

  function close() {
    if (closed) return;

    closed = true;

    if (isOpen) {
      ws.send(JSON.stringify({ text: "" }));
    }

    ws.close();
  }

  return { sendText, close };
}
