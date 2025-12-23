import { VertexAI } from "@google-cloud/vertexai";

// Check for required environment variable
if (!process.env.GCP_PROJECT_ID) {
  console.error("❌ GCP_PROJECT_ID environment variable is not set!");
  console.error("   Set it with: export GCP_PROJECT_ID=your-project-id");
}

let vertexAI: VertexAI;
let model: any;

try {
  vertexAI = new VertexAI({
    project: process.env.GCP_PROJECT_ID!,
    location: "us-central1",
  });

  model = vertexAI.preview.getGenerativeModel({
    model: "gemini-2.5-flash",
  });

  console.log("✅ Vertex AI (Gemini) initialized");
} catch (error) {
  console.error("❌ Failed to initialize Vertex AI:", error);
  throw error;
}

export async function streamGemini(
  prompt: string,
  onToken: (token: string) => void
) {
  console.log("🤖 Calling Vertex AI (Gemini) with prompt:", prompt.substring(0, 50) + "...");
  
  try {
    const stream = await model.generateContentStream({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    console.log("📡 Vertex AI stream started");

    let tokenCount = 0;
    for await (const chunk of stream.stream) {
      const text =
        chunk.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        tokenCount++;
        console.log(`📝 Vertex AI token ${tokenCount}: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
        onToken(text);
      }
    }

    console.log(`✅ Vertex AI completed (${tokenCount} tokens)`);
  } catch (error) {
    console.error("❌ Vertex AI error:", error);
    throw error;
  }
}
