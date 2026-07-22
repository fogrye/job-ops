import { describe, expect, it } from "vitest";
import {
  applyTailoredExperience,
  applyTailoredSkills,
  extractProjectsFromResume,
  extractTailoredExperienceSource,
} from "./tailoring";

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

  it("clears flat skills when no supplied skill is available", () => {
    const resume = {
      sections: {
        skills: {
          items: [{ id: "php", name: "PHP", level: 5, keywords: [] }],
        },
      },
    };

    applyTailoredSkills(resume, ["Unknown technology"]);

    expect(resume.sections.skills.items).toEqual([]);
  });
  it("selects non-overlapping source units and preserves unsupported blocks", () => {
    const resume = {
      sections: {
        experience: {
          items: [
            {
              id: "e1",
              description:
                "<h3>Backend Engineer</h3><ul><li><p>Built APIs.</p><ul><li>Nested detail.</li></ul></li><li><p>Maintained services.</p></li></ul><div>Keep this block.</div><p>First context.</p>\n\n<p>Second context.</p>",
              roles: [],
            },
          ],
        },
      },
    };

    const source = extractTailoredExperienceSource(resume);
    expect(source.entries[0]?.groups).toHaveLength(2);
    expect(source.entries[0]?.groups[0]?.units).toHaveLength(2);
    expect(source.entries[0]?.groups[1]?.units).toHaveLength(2);

    const [listGroup, paragraphGroup] = source.entries[0]?.groups ?? [];
    applyTailoredExperience(resume, {
      entries: [
        {
          id: "e1",
          groups: [
            {
              id: listGroup.id,
              unitIds: [listGroup.units[1].id],
            },
            {
              id: paragraphGroup.id,
              unitIds: [paragraphGroup.units[1].id, paragraphGroup.units[0].id],
            },
          ],
        },
      ],
    });

    expect(resume.sections.experience.items[0].description).toBe(
      "<h3>Backend Engineer</h3><ul><li><p>Maintained services.</p></li></ul><div>Keep this block.</div><p>Second context.</p><p>First context.</p>",
    );
  });

  it("leaves a description unchanged for stale or empty selections", () => {
    const resume = {
      sections: {
        experience: {
          items: [
            {
              id: "e1",
              description:
                "<ul><li>Built APIs.</li><li>Shipped services.</li></ul>",
              roles: [],
            },
          ],
        },
      },
    };
    const original = resume.sections.experience.items[0].description;
    const source = extractTailoredExperienceSource(resume);
    const group = source.entries[0]?.groups[0];

    applyTailoredExperience(resume, {
      entries: [
        {
          id: "e1",
          groups: [{ id: group.id, unitIds: ["stale-unit-id"] }],
        },
      ],
    });
    expect(resume.sections.experience.items[0].description).toBe(original);

    applyTailoredExperience(resume, {
      entries: [{ id: "e1", groups: [{ id: group.id, unitIds: [] }] }],
    });
    expect(resume.sections.experience.items[0].description).toBe(original);

    applyTailoredExperience(resume, "{invalid-json");
    expect(resume.sections.experience.items[0].description).toBe(original);
  });
});
