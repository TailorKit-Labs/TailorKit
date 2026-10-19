import { expect, it } from "vite-plus/test";

import { appAgentSkills } from "./skills";

const linkPattern = /\]\((?<target>references\/[^)]+)\)/gu;

it("bundles every linked recipe as a readable skill resource", () => {
  for (const skill of appAgentSkills) {
    const files = skill.files ?? [];
    const targets = [...skill.content.matchAll(linkPattern)].map(
      (match) => match.groups?.target
    );
    for (const target of targets) {
      const resource = files.find((file) => file.path === target);
      expect(resource, `${skill.name}: ${target}`).toBeDefined();
      expect(resource?.content.length).toBeGreaterThan(0);
    }
    for (const resource of files) {
      expect(targets, `${skill.name}: unlinked resource`).toContain(
        resource.path
      );
    }
  }
});
