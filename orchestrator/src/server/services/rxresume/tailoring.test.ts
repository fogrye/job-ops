import { describe, expect, it } from "vitest";
import { applyTailoredSkills, extractProjectsFromResume } from "./tailoring";

describe("rxresume tailoring", () => {
  it("strips html from project catalog descriptions", () => {
    const { catalog, selectionItems } = extractProjectsFromResume({
      sections: {
        projects: {
          items: [
            {
              id: "p1",
              name: "Analytics",
              description:
                "<ul><li><p><strong>Built analytics</strong> using FastAPI.</p></li></ul>",
              hidden: false,
              period: "2024",
            },
          ],
        },
      },
    });

    expect(catalog[0].description).toBe("Built analytics using FastAPI.");
    expect(selectionItems[0].summaryText).toBe(
      "Built analytics using FastAPI.",
    );
  });

  it("applies a ranked flat skill list without inventing template entries", () => {
    const resume = {
      sections: {
        skills: {
          items: [
            { id: "php", name: "PHP", level: 5, keywords: [] },
            { id: "docker", name: "Docker", level: 5, keywords: [] },
            { id: "k8s", name: "Kubernetes", level: 4, keywords: [] },
          ],
        },
      },
    };

    applyTailoredSkills(resume, [
      "Kubernetes",
      "Unknown technology",
      "PHP",
      "Kubernetes",
    ]);

    expect(resume.sections.skills.items).toEqual([
      { id: "k8s", name: "Kubernetes", level: 4, keywords: [] },
      { id: "php", name: "PHP", level: 5, keywords: [] },
    ]);
  });
});
