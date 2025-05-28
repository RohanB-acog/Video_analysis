// lib/ollama.ts
import myLama from "./MyLama";
import { safeLog } from "./logger";
import * as yaml from "js-yaml";
import * as fs from "fs";
import path from "path";

let DISEASE_SPACE_PROMPT: string;

try {
  const promptLibraryPath = path.join(process.cwd(), "prompt_library.yaml");
  safeLog("error", `[DEBUG] Loading prompt from: ${promptLibraryPath}`);
  const promptLibrary = yaml.load(fs.readFileSync(promptLibraryPath, "utf8")) as any;
  DISEASE_SPACE_PROMPT = promptLibrary.disease_space.prompt;
  if (!DISEASE_SPACE_PROMPT) {
    throw new Error("disease_space.prompt not found in prompt_library.yaml");
  }
} catch (error) {
  safeLog("error", "❌ Error loading prompt template:", error);
  process.exit(1);
}

export interface AnalysisResult {
  video_type: string;
  name: string | null;
  current_age: string | null;
  onset_age: string | null;
  sex: string | null;
  location: string | null;
  symptoms: string[] | null;
  medicalHistoryOfPatient: string | null;
  familyMedicalHistory: string | null;
  challengesFacedDuringDiagnosis: string[] | null;
  key_opinion: string | null;
  topicOfInformation: string | null;
  detailsOfInformation: string | null;
  headline: string | null;
  summaryOfNews: string | null;
}

export async function analyzeTranscript(
  videoId: string,
  transcript: string,
  title: string
): Promise<AnalysisResult | AnalysisResult[] | null> {
  safeLog("error", `[DEBUG] Starting analysis for video ${videoId}...`);

  try {
    if (!transcript || transcript.trim().length === 0) {
      safeLog("error", `❌ No valid transcript provided for video ${videoId}`);
      return null;
    }
    safeLog("error", `[DEBUG] Using provided transcript of length: ${transcript.length}`);
    safeLog("error", `[DEBUG] Transcript preview: ${transcript.slice(0, 100)}...`);

    const structuredPrompt = DISEASE_SPACE_PROMPT
      .replace("{title}", title)
      .replace("{transcript}", transcript)
      .replace("{videoId}", videoId);
    safeLog("error", `[DEBUG] Structured prompt: ${structuredPrompt.slice(0, 200)}...`);

    safeLog("error", "[DEBUG] Sending to LLM...");
    const content = await myLama.generate(structuredPrompt);
    if (!content) {
      safeLog("error", `[ERROR] LLM returned empty response for video ${videoId}`);
      return null;
    }
    safeLog("error", "[DEBUG] Raw LLM response:", content);

    // Clean the response: remove code fences and trim
    let jsonString = content.replace(/^```json\n|\n```$/g, '').replace(/^```|\n```$/g, '').trim();
    // Remove trailing commas
    jsonString = jsonString.replace(/,\s*([\]}])/g, '$1');

    let parsedData;
    try {
      parsedData = JSON.parse(jsonString);
    } catch (parseError) {
      safeLog("error", `[ERROR] Failed to parse JSON for video ${videoId}: ${parseError.message}`);
      safeLog("error", `[DEBUG] Problematic JSON string: ${jsonString.substring(0, 1000)}...`);
      return null;
    }

    // Helper function to merge multiple patient results into one
    const mergePatientResults = (patients: any[]): AnalysisResult => {
      const merged: AnalysisResult = {
        video_type: "patient story",
        name: patients.length > 1 ? "Multiple Patients" : patients[0].name ?? null,
        current_age: null,
        onset_age: null,
        sex: null,
        location: null,
        symptoms: [],
        medicalHistoryOfPatient: null,
        familyMedicalHistory: null,
        challengesFacedDuringDiagnosis: [],
        key_opinion: null,
        topicOfInformation: null,
        detailsOfInformation: null,
        headline: null,
        summaryOfNews: null
      };

      // Aggregate fields
      patients.forEach(patient => {
        if (patient.symptoms) {
          merged.symptoms = [...new Set([...merged.symptoms, ...patient.symptoms])];
        }
        if (patient.medicalHistoryOfPatient) {
          merged.medicalHistoryOfPatient = merged.medicalHistoryOfPatient
            ? `${merged.medicalHistoryOfPatient}; ${patient.medicalHistoryOfPatient}`
            : patient.medicalHistoryOfPatient;
        }
        if (patient.familyMedicalHistory) {
          merged.familyMedicalHistory = merged.familyMedicalHistory
            ? `${merged.familyMedicalHistory}; ${patient.familyMedicalHistory}`
            : patient.familyMedicalHistory;
        }
        if (patient.challengesFacedDuringDiagnosis) {
          merged.challengesFacedDuringDiagnosis = [
            ...new Set([...merged.challengesFacedDuringDiagnosis, ...patient.challengesFacedDuringDiagnosis])
          ];
        }
        if (patient.location && !merged.location) {
          merged.location = patient.location;
        }
      });

      return merged;
    };

    // Handle web scraping (http/https) vs. YouTube inputs
    if (videoId.startsWith("http")) {
      // For web scraping, return array as-is
      if (Array.isArray(parsedData)) {
        return parsedData.map(item => ({
          video_type: item.video_type || "patient story",
          name: item.name ?? null,
          current_age: item.current_age ?? null,
          onset_age: item.onset_age ?? null,
          sex: item.sex ?? null,
          location: item.location ?? null,
          symptoms: Array.isArray(item.symptoms) ? item.symptoms : null,
          medicalHistoryOfPatient: item.medicalHistoryOfPatient ?? null,
          familyMedicalHistory: item.familyMedicalHistory ?? null,
          challengesFacedDuringDiagnosis: Array.isArray(item.challengesFacedDuringDiagnosis)
            ? item.challengesFacedDuringDiagnosis
            : null,
          key_opinion: item.key_opinion ?? null,
          topicOfInformation: item.topicOfInformation ?? null,
          detailsOfInformation: item.detailsOfInformation ?? null,
          headline: item.headline ?? null,
          summaryOfNews: item.summaryOfNews ?? null
        }));
      } else {
        // Single object for web scraping (rare case)
        return [{
          video_type: parsedData.video_type || "patient story",
          name: parsedData.name ?? null,
          current_age: parsedData.current_age ?? null,
          onset_age: parsedData.onset_age ?? null,
          sex: parsedData.sex ?? null,
          location: parsedData.location ?? null,
          symptoms: Array.isArray(parsedData.symptoms) ? parsedData.symptoms : null,
          medicalHistoryOfPatient: parsedData.medicalHistoryOfPatient ?? null,
          familyMedicalHistory: parsedData.familyMedicalHistory ?? null,
          challengesFacedDuringDiagnosis: Array.isArray(parsedData.challengesFacedDuringDiagnosis)
            ? parsedData.challengesFacedDuringDiagnosis
            : null,
          key_opinion: parsedData.key_opinion ?? null,
          topicOfInformation: parsedData.topicOfInformation ?? null,
          detailsOfInformation: parsedData.detailsOfInformation ?? null,
          headline: parsedData.headline ?? null,
          summaryOfNews: parsedData.summaryOfNews ?? null
        }];
      }
    } else {
      // For YouTube inputs, ensure single object
      if (Array.isArray(parsedData)) {
        if (parsedData.length === 0) return null;
        return mergePatientResults(parsedData);
      } else {
        return {
          video_type: parsedData.video_type || "Informational",
          name: parsedData.name ?? null,
          current_age: parsedData.current_age ?? null,
          onset_age: parsedData.onset_age ?? null,
          sex: parsedData.sex ?? null,
          location: parsedData.location ?? null,
          symptoms: Array.isArray(parsedData.symptoms) ? parsedData.symptoms : null,
          medicalHistoryOfPatient: parsedData.medicalHistoryOfPatient ?? null,
          familyMedicalHistory: parsedData.familyMedicalHistory ?? null,
          challengesFacedDuringDiagnosis: Array.isArray(parsedData.challengesFacedDuringDiagnosis)
            ? parsedData.challengesFacedDuringDiagnosis
            : null,
          key_opinion: parsedData.key_opinion ?? null,
          topicOfInformation: parsedData.topicOfInformation ?? null,
          detailsOfInformation: parsedData.detailsOfInformation ?? null,
          headline: parsedData.headline ?? null,
          summaryOfNews: parsedData.summaryOfNews ?? null
        };
      }
    }
  } catch (error) {
    safeLog("error", `❌ Error analyzing video ${videoId}: ${error.message}`);
    return null;
  }
}