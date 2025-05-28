import { Ollama } from "@langchain/community/llms/ollama";
import axios from "axios";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AzureOpenAI } from "openai";
import * as dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

class MyLama {
  private ollamaBaseUrl: string;
  private ollamaAuth: string;
  private openaiApiKey: string;
  private geminiApiKey: string;
  private azureEndpoint: string;
  private azureApiKey: string;
  private azureDeployment: string;
  private azureApiVersion: string;
  private selectedModel: string;
  private rl: readline.Interface;

  constructor() {
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "";
    this.ollamaAuth = Buffer.from(
      `${process.env.USER_NAME}:${process.env.USER_PASSWORD}`
    ).toString("base64");
    this.openaiApiKey = process.env.OPENAI_API_KEY || "";
    this.geminiApiKey = process.env.GEMINI_API_KEY || "";
    this.azureEndpoint = process.env.AZURE_ENDPOINT || "https://acogazureaimodels.cognitiveservices.azure.com/";
    this.azureApiKey = process.env.AZURE_API_KEY || "hvX58xnrawdCvWPTNO0iMspVq6sgBZ0ZmSQyA2mke1aUXwdjj8hpJQQJ99BBACYeBjFXJ3w3AAAAACOGeRKp";
    this.azureDeployment = process.env.AZURE_DEPLOYMENT || "gpt-4";
    this.azureApiVersion = process.env.AZURE_API_VERSION || "2025-01-01-preview";
    this.selectedModel = process.env.LLM_MODEL || "ollama";

    // Initialize readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private async ollamaModel(prompt: string, model: string = "deepseek-r1:14b") {
    console.log(`Using Ollama model: ${model}`);
    try {
      const llm = new Ollama({
        baseUrl: this.ollamaBaseUrl,
        model,
        headers: {
          Authorization: `Basic ${this.ollamaAuth}`,
          "Content-Type": "application/json",
        },
      });

      return await llm.call(prompt);
    } catch (error) {
      console.error("Ollama Error:", error);
      throw error;
    }
  }

  private async chatGPTModel(prompt: string, model: string = "gpt-4") {
    console.log(`Using OpenAI model: ${model}`);
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.openaiApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error("ChatGPT Error:", error);
      throw error;
    }
  }

  private async azureModel(prompt: string, model: string = "gpt-4") {
    console.log(`Using Azure model: ${model}`);
    try {
      // Determine the deployment based on the model
      const deployment = model === "gpt-4o" ? "gpt-4o" : this.azureDeployment;

      const options = {
        endpoint: this.azureEndpoint,
        apiKey: this.azureApiKey,
        deployment: deployment,
        apiVersion: this.azureApiVersion,
      };

      const client = new AzureOpenAI(options);

      const response = await client.chat.completions.create({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
        max_tokens: 4096,
        temperature: 1,
        top_p: 1,
        model: model,
      });

      if (response?.error !== undefined && response.status !== 200) {
        throw new Error(response.error);
      }

      return response.choices[0].message.content;
    } catch (error) {
      console.error(`Azure ${model} Error:`, error);
      throw error;
    }
  }

  private async geminiModel(prompt: string) {
    console.log(`Using Google Gemini model`);
    const model = new ChatGoogleGenerativeAI({
      modelName: "gemini-pro",
      maxOutputTokens: 2048,
      apiKey: this.geminiApiKey,
    });

    try {
      const response = await model.invoke(prompt);
      return response.content;
    } catch (error) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }

  private async processModelResponse(prompt: string) {
    const modelLower = this.selectedModel.toLowerCase();

    // Handle Ollama models
    if ([
      "deepseek-r1:1.5b",
      "deepseek-r1:14b",
      "llama3.2-vision",
      "dolphin3",
      "llama3",
      "llama3.1",
      "llama3.2"
    ].includes(modelLower)) {
      return await this.ollamaModel(prompt, modelLower);
    }
    // Handle OpenAI models (any model name starting with "gpt-" or "openai")
    else if (modelLower.startsWith("gpt-") || modelLower === "openai") {
      return await this.chatGPTModel(prompt, modelLower === "openai" ? "gpt-4" : modelLower);
    }
    // Handle Azure models (GPT-4 and GPT-4o)
    else if (modelLower === "azure-gpt-4") {
      return await this.azureModel(prompt, "gpt-4");
    }
    else if (modelLower === "azure-gpt-4o") {
      return await this.azureModel(prompt, "gpt-4o");
    }
    // Handle Gemini
    else if (modelLower === "gemini") {
      return await this.geminiModel(prompt);
    }
    else {
      throw new Error(`Unsupported LLM Model: ${this.selectedModel}`);
    }
  }

  async generate(initialPrompt?: string) {
    if (initialPrompt) {
      const response = await this.processModelResponse(initialPrompt);
      console.log("Response:", response);
      return response;
    }

    // Start interactive mode
    console.log(`\nInteractive Mode - Using ${this.selectedModel}`);
    console.log('Type "exit" to quit\n');

    const askQuestion = () => {
      this.rl.question("You: ", async (input) => {
        if (input.toLowerCase() === "exit") {
          this.rl.close();
          return;
        }

        try {
          const response = await this.processModelResponse(input);
          console.log("\nAssistant:", response, "\n");
        } catch (error) {
          console.error("Error:", error);
        }

        askQuestion(); // Continue the conversation
      });
    };

    askQuestion();

    // Handle readline close
    this.rl.on("close", () => {
      console.log("\nGoodbye!");
      process.exit(0);
    });
  }
}

export default new MyLama();