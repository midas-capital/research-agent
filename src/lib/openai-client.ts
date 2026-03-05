import OpenAI from "openai";
import { config } from "../config.js";

// gpt-4o-mini 用の共通クライアント
export const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

