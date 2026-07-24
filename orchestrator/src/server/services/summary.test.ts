import type { ResumeProfile } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();
const getProviderMock = vi.fn();
const getBaseUrlMock = vi.fn();
const settingsMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getEffectiveSettings: vi.fn(),
}));

vi.mock("../repositories/settings", () => settingsMocks);
vi.mock("@server/repositories/settings", () => settingsMocks);
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: settingsMocks.getEffectiveSettings,
}));

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
    getProvider = getProviderMock;
    getBaseUrl = getBaseUrlMock;
  },
}));

vi.mock("./writing-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./writing-style")>();

  return {
    ...actual,
    getWritingStyle: vi.fn(),
  };
});

import { getSetting } from "../repositories/settings";
import { generateTailoring } from "./summary";
import { getWritingStyle } from "./writing-style";

describe("generateTailoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderMock.mockReturnValue("openrouter");
    getBaseUrlMock.mockReturnValue("https://openrouter.ai");
    settingsMocks.getEffectiveSettings.mockResolvedValue({
      model: { value: "gpt-4o-mini" },
      llmProvider: { value: "openrouter" },
      llmBaseUrl: { value: null },
      llmPurposeOverrides: { value: {} },
      modelTailoring: { value: null },
    });
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
      },
    });
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Keep it under 90 words",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });
  });

  it("passes shared writing-style and language instructions into tailoring prompts", async () => {
    const profile: ResumeProfile = {
      basics: {
        name: "Test User",
        label: "Engineer",
        summary: "Existing summary",
      },
    };

    await generateTailoring("<p>Build <strong>APIs</strong></p>", profile);

    expect(callJsonMock).toHaveBeenCalledTimes(1);

    const request = callJsonMock.mock.calls[0]?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "WRITING STYLE PREFERENCES:",
    );
    expect(request?.messages?.[0]?.content).toContain("Tone: friendly");
    expect(request?.messages?.[0]?.content).toContain("Formality: low");
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Avoid these words or phrases: synergy",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Do NOT translate, localize, or paraphrase the headline, even if the rest of the output is in German.",
    );
    expect(request?.messages?.[0]?.content).toContain(
      'Keep "headline" in the exact original job-title wording from the JD.',
    );
    expect(request?.messages?.[0]?.content).toContain("Build APIs");
    expect(request?.messages?.[0]?.content).not.toContain("<strong>");
    expect(request?.messages?.[0]?.content).toContain(
      '"basics":{"name":"Test User"',
    );
  });

  it("keeps grouped skills as the default contract", async () => {
    await generateTailoring("Build APIs", {
      sections: {
        skills: {
          items: [
            {
              id: "backend",
              name: "Backend",
              description: "",
              level: 4,
              keywords: ["TypeScript"],
              visible: true,
            },
          ],
        },
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.jsonSchema.schema.properties.skills).toMatchObject({
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          keywords: { type: "array" },
        },
      },
    });
    expect(request?.messages?.[0]?.content).toContain(
      "Keep my original skill levels and categories",
    );
  });

  it("removes language directives from constraints so explicit language settings win", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Always respond in French. Keep it under 90 words.",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).not.toContain(
      "Always respond in French",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
  });

  it("uses the detected job description language when configured", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "match-job-description",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring(
      "Wir suchen Erfahrung mit Entwicklung und Verantwortung für APIs.",
      {
        basics: {
          name: "Test User",
          label: "Engineer",
        },
      },
    );

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
  });

  it("falls back to english when job description language detection is weak", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "match-job-description",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Senior platform role with Kubernetes.", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: English",
    );
  });

  it("uses a stored tailoring prompt template override", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "tailoringPromptTemplate"
        ? "Tailor {{tone}} {{outputLanguage}} {{unknownToken}}"
        : null,
    );

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Tailor friendly German {{unknownToken}}",
    );
  });

  it("includes word limit when summaryMaxWords is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
  });

  it("uses singular 'word' when summaryMaxWords is 1", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 1,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 1 word.");
  });

  it("omits word limit line when summaryMaxWords is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("Maximum");
  });

  it("includes keyword limit when maxKeywordsPerSkill is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 8 keywords per category");
  });

  it("omits keyword limit when maxKeywordsPerSkill is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("keywords per category");
  });

  it("includes both limits and constraints when all set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "keep under 90 words",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
    expect(prompt).toContain("Maximum 8 keywords per category");
    // "keep under 90 words" is stripped from constraints because summaryMaxWords (35) takes precedence
    expect(prompt).not.toContain("keep under 90 words");
  });

  it("uses ranked flat skills when the profile has no skill keywords", async () => {
    callJsonMock.mockResolvedValueOnce({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Platform Engineer",
        skills: ["Kubernetes", "Unknown", "PHP", "Kubernetes"],
      },
    });

    const result = await generateTailoring("Kubernetes platform role", {
      sections: {
        skills: {
          items: [
            {
              id: "php",
              name: "PHP",
              description: "",
              level: 5,
              keywords: [],
              visible: true,
            },
            {
              id: "k8s",
              name: "Kubernetes",
              description: "",
              level: 4,
              keywords: [],
              visible: true,
            },
          ],
        },
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.jsonSchema.schema.properties.skills).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(request?.messages?.[0]?.content).toContain(
      "every existing item name is an actual technology",
    );
    expect(result.data?.skills).toEqual(["Kubernetes", "PHP"]);
  });
  it("uses ID-only source-unit selections for enabled work-history tailoring", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "tailorWorkHistory" ? "1" : null,
    );
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
        experience: { entries: [] },
      },
    });

    await generateTailoring("Build APIs", {
      sections: {
        experience: {
          items: [
            {
              id: "experience-1",
              company: "Acme",
              position: "Engineer",
              location: "",
              date: "",
              summary: "<ul><li>Built APIs.</li></ul>",
              description: "<ul><li>Built APIs.</li></ul>",
              visible: true,
            },
          ],
        },
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.jsonSchema.schema.properties.experience).toBeDefined();
    expect(request?.messages?.[0]?.content).toContain(
      "WORK HISTORY SELECTION CONTRACT",
    );
    expect(request?.messages?.[0]?.content).toContain("Built APIs.");
    expect(request?.messages?.[0]?.content).toContain(
      "Never return replacement work-history prose",
    );
  });

  it("scopes the work-history prompt to the most recent role when latest-only is enabled", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key === "tailorWorkHistory") return "1";
      if (key === "tailorLatestExperienceOnly") return "1";
      return null;
    });
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
        experience: { entries: [] },
      },
    });

    await generateTailoring("Build APIs", {
      sections: {
        experience: {
          items: [
            {
              id: "experience-recent",
              company: "Acme",
              position: "Engineer",
              location: "",
              date: "",
              summary: "<ul><li>Most recent role.</li></ul>",
              description: "<ul><li>Most recent role.</li></ul>",
              visible: true,
            },
            {
              id: "experience-older",
              company: "Old Co",
              position: "Junior Engineer",
              location: "",
              date: "",
              summary: "<ul><li>Older role.</li></ul>",
              description: "<ul><li>Older role.</li></ul>",
              visible: true,
            },
          ],
        },
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain("Most recent role.");
    expect(request?.messages?.[0]?.content).not.toContain("Older role.");
  });

  it("ignores a stale latest-only preference once work-history tailoring is disabled", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key === "tailorWorkHistory") return "0";
      if (key === "tailorLatestExperienceOnly") return "1";
      return null;
    });
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
      },
    });

    await generateTailoring("Build APIs", {
      sections: {
        experience: {
          items: [
            {
              id: "experience-recent",
              company: "Acme",
              position: "Engineer",
              location: "",
              date: "",
              summary: "Most recent role.",
              visible: true,
            },
            {
              id: "experience-older",
              company: "Old Co",
              position: "Junior Engineer",
              location: "",
              date: "",
              summary: "Older role.",
              visible: true,
            },
          ],
        },
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    // General context for summary/headline/skills should still see both
    // employers; only the work-history-selection feature narrows scope.
    expect(request?.messages?.[0]?.content).toContain("Older role.");
  });
});
