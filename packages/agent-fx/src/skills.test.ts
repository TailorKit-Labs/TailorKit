import { expect, it } from "vite-plus/test";

import { appAgentReferences, appAgentSkills } from "./skills";

const linkPattern =
  /\]\((?<target>\/workspace\/\.patchsmith-agent\/references\/[^)]+)\)/gu;

it("provisions every linked recipe without embedding it in the initial prompt", () => {
  for (const skill of appAgentSkills) {
    expect(skill).not.toHaveProperty("files");
    expect(skill.content).not.toContain("```");

    const guide = appAgentReferences.find((file) =>
      skill.content.includes(file.path)
    );

    expect(guide, skill.name).toBeDefined();
    expect(skill.content.length).toBeLessThan(guide?.content.length ?? 0);
  }

  const targets = [...appAgentSkills, ...appAgentReferences].flatMap((file) =>
    [...file.content.matchAll(linkPattern)].map((match) => match.groups?.target)
  );

  for (const target of targets) {
    const resource = appAgentReferences.find((file) => file.path === target);
    expect(resource, target).toBeDefined();
    expect(resource?.content.length).toBeGreaterThan(0);
  }

  for (const resource of appAgentReferences) {
    expect(targets, "Unlinked recipe").toContain(resource.path);
  }
});
