import { SpeechClient } from "@google-cloud/speech";

// Check for credentials
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn("⚠️  GOOGLE_APPLICATION_CREDENTIALS not set in environment");
  console.warn("   Set it with: export GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json");
}

// Initialize SpeechClient with error handling
let client: SpeechClient;
try {
  client = new SpeechClient();
  console.log("✅ Google Cloud Speech client initialized");
} catch (error) {
  console.error("❌ Failed to initialize Speech client:", error);
  throw error;
}

export function createStreamingSTT(
  onPartial: (text: string) => void,
  onFinal: (text: string) => void
) {
  console.log("🎤 Creating STT stream...");
  const recognizeStream = client
    .streamingRecognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    })
    .on("data", (data) => {
      console.log("📨 Received data from Google Speech API");
      console.log("   Results count:", data.results?.length || 0);
      
      const result = data.results?.[0];
      if (!result) {
        console.log("   ⚠️ No result in response");
        return;
      }

      const transcript = result.alternatives?.[0]?.transcript;
      if (!transcript) {
        console.log("   ⚠️ No transcript in result (might be empty or non-speech audio)");
        return;
      }

      if (result.isFinal) {
        console.log(`✅ STT Final: "${transcript}"`);
        onFinal(transcript);
      } else {
        console.log(`⏳ STT Partial: "${transcript}"`);
        onPartial(transcript);
      }
    })
    .on("error", (err) => {
      console.error("❌ STT error:", err);
      console.error("   Error details:", JSON.stringify(err, null, 2));
    })
    .on("end", () => {
      console.log("🔚 STT stream ended");
    });

  return {
    write(chunk: Buffer) {
      console.log(`📝 Writing ${chunk.length} bytes to STT stream`);
      try {
        recognizeStream.write(chunk);
      } catch (error) {
        console.error("❌ Error writing to STT stream:", error);
      }
    },
    close() {
      console.log("🔒 Closing STT stream");
      recognizeStream.end();
    },
  };
}
