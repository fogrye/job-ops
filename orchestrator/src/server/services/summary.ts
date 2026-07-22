/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type { ResumeProfile } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import {
  extractTailoredExperienceSource,
  parseTailoredExperienceInput,
  type TailoredExperienceInput,
} from "./rxresume/tailoring";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
  type WritingStyle,
} from "./writing-style";

export type TailoredSkillGroups = Array<{
  name: string;
  keywords: string[];
}>;
export type TailoredSkills = TailoredSkillGroups | string[];
export interface TailoredData {
  summary: string;
  headline: string;
  skills: TailoredSkills;
  experience?: TailoredExperienceInput | null;
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
}

/** JSON schema for resume tailoring response */
function getTailoringSchema(
  flatSkills: boolean,
  tailorWorkHistory: boolean,
): JsonSchemaDefinition {
  const experienceSchema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            groups: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  unitIds: { type: "array", items: { type: "string" } },
                },
                required: ["id", "unitIds"],
                additionalProperties: false,
              },
            },
            roles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  groups: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        unitIds: {
                          type: "array",
                          items: { type: "string" },
                        },
                      },
                      required: ["id", "unitIds"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["id", "groups"],
                additionalProperties: false,
              },
            },
          },
          required: ["id", "groups"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };

  const properties: Record<string, unknown> = {
    headline: {
      type: "string",
      description: "Job title headline matching the JD exactly",
    },
    summary: {
      type: "string",
      description: "Tailored resume summary paragraph",
    },
    skills: flatSkills
      ? {
          type: "array",
          description:
            "Ranked subset of existing flat skill names tailored to the job",
          items: { type: "string" },
        }
      : {
          type: "array",
          description: "Skills sections with keywords tailored to the job",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
            },
            required: ["name", "keywords"],
            additionalProperties: false,
          },
        },
  };
  if (tailorWorkHistory) properties.experience = experienceSchema;

  return {
    name: "resume_tailoring",
    schema: {
      type: "object",
      properties,
      required: tailorWorkHistory
        ? ["headline", "summary", "skills", "experience"]
        : ["headline", "summary", "skills"],
      additionalProperties: false,
    },
  };
}

function normalizeFlatSkills(
  skills: TailoredSkills,
  profile: ResumeProfile,
): string[] {
  if (
    !Array.isArray(skills) ||
    !skills.every((skill) => typeof skill === "string")
  ) {
    return [];
  }

  const names = new Map(
    (profile.sections?.skills?.items ?? []).map((skill) => [
      skill.name.toLocaleLowerCase(),
      skill.name,
    ]),
  );
  const seen = new Set<string>();

  return skills.flatMap((skill) => {
    const name = names.get(skill.trim().toLocaleLowerCase());
    if (!name || seen.has(name)) return [];
    seen.add(name);
    return [name];
  });
}

async function isWorkHistoryTailoringEnabled(): Promise<boolean> {
  const raw = await settingsRepo.getSetting("tailorWorkHistory");
  return (
    settingsRegistry.tailorWorkHistory.parse(raw ?? undefined) ??
    settingsRegistry.tailorWorkHistory.default()
  );
}

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<TailoringResult> {
  const [model, writingStyle, tailorWorkHistory] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
    isWorkHistoryTailoringEnabled(),
  ]);
  const profileSkills = profile.sections?.skills?.items;
  const flatSkills =
    profileSkills !== undefined &&
    profileSkills.length > 0 &&
    profileSkills.every((skill) => !skill.keywords?.length);
  const prompt = await buildTailoringPrompt(
    profile,
    jobDescription,
    writingStyle,
    flatSkills,
    tailorWorkHistory,
  );

  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<TailoredData>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: getTailoringSchema(flatSkills, tailorWorkHistory),
  });
  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `${result.error} (${context})`,
    };
  }
  const { summary, headline, skills, experience } = result.data;
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
  }

  return {
    success: true,
    data: {
      summary: sanitizeText(summary || ""),
      headline: sanitizeText(headline || ""),
      skills: flatSkills
        ? normalizeFlatSkills(skills || [], profile)
        : skills || [],
      experience: tailorWorkHistory
        ? parseTailoredExperienceInput(experience)
        : undefined,
    },
  };
}

/**
 * Backwards compatibility wrapper if needed, or alias.
 */
export async function generateSummary(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // If we just need summary, we can discard the rest (or cache it? but here we just return summary)
  const result = await generateTailoring(jobDescription, profile);
  return {
    success: result.success,
    summary: result.data?.summary,
    error: result.error,
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  jd: string,
  writingStyle: WritingStyle,
  flatSkills: boolean,
  tailorWorkHistory: boolean,
): Promise<string> {
  const jobDescription = stripHtmlTags(jd);
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
    jobDescription,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (!flatSkills && writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  // Extract only needed parts of profile to save tokens
  const experienceSource = tailorWorkHistory
    ? extractTailoredExperienceSource(
        profile as unknown as Record<string, unknown>,
      )
    : null;
  const relevantProfile = {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label, // Original headline
      summary: profile.basics?.summary,
    },
    skills: profile.sections?.skills,
    projects: profile.sections?.projects?.items?.map((p) => ({
      name: p.name,
      description: p.description,
      keywords: p.keywords,
    })),
    experience: profile.sections?.experience?.items?.map((e) => ({
      id: e.id,
      company: e.company,
      position: e.position,
      summary: e.summary,
      source: experienceSource?.entries.find((entry) => entry.id === e.id),
    })),
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");

  const renderedPrompt = renderPromptTemplate(template, {
    jobDescription,
    profileJson: JSON.stringify(relevantProfile),
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      !flatSkills && writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    skillModeInstructions: flatSkills
      ? `- My skills are a flat list: every existing item name is an actual technology, not a category.\n   - Return a ranked JSON array of only exact existing skill names, highest relevance to this employer/JD first.\n   - Remove unrelated skills. Do not add, rename, group, assign levels, or emit keywords.`
      : `- Review my existing skills section structure.
   - Keyword Stuffing: Swap synonyms to match the JD exactly (e.g. "TDD" -> "Unit Testing", "ReactJS" -> "React").
   - Keep my original skill levels and categories, just rename/reorder keywords to prioritize JD terms.
   - Return the full "items" array for the skills section, preserving the structure: { "name": "Frontend", "keywords": [...] }.`,
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
  if (!tailorWorkHistory) return renderedPrompt;

  return `${renderedPrompt}

WORK HISTORY SELECTION CONTRACT:
- Select only source unit IDs from the supplied profile JSON.
- Return IDs only. Never return replacement work-history prose.
- Select the most vacancy-relevant existing units; omit irrelevant units.
- Reorder units only within their original group. Do not move content between groups, roles, or employers.
- Preserve every fact exactly as provided. Do not infer or add metrics, technologies, responsibilities, scope, seniority, or achievements.
- Include every supported group with at least one selected unit. If a group cannot be honestly improved, preserve its original unit order.
- Return the JSON object under \`experience.entries\` with only \`id\`, \`groups\`, \`roles\`, and \`unitIds\` fields allowed by the schema.`;
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
