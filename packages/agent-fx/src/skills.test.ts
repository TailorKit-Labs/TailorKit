import { expect, it } from "vite-plus/test";

import { appAgentReferences, appAgentSkills } from "./skills";

const linkPattern =
  /\]\((?<target>\/workspace\/\.tailorkit-agent\/references\/[^)]+)\)/gu;

it("provisions every linked recipe without embedding it in the initial prompt", () => {
  const targets = appAgentSkills.flatMap((skill) => {
    expect(skill).not.toHaveProperty("files");
    return [...skill.content.matchAll(linkPattern)].map(
      (match) => match.groups?.target
    );
  });
  for (const target of targets) {
    const resource = appAgentReferences.find((file) => file.path === target);
    expect(resource, target).toBeDefined();
    expect(resource?.content.length).toBeGreaterThan(0);
  }
  for (const resource of appAgentReferences) {
    expect(targets, "Unlinked recipe").toContain(resource.path);
  }
});
