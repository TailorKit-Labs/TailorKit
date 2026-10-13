import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const statement = {
  ...defaultStatements,

  apiKey: ["create", "read", "update", "delete"],
  invitation: [...defaultStatements.invitation, "read"],
  project: ["create", "share", "update", "delete"],
  projectApiKey: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

const member = ac.newRole({
  apiKey: ["create", "read"],
  project: ["create"],
  projectApiKey: ["create", "read"],
  ...memberAc.statements,
});

const admin = ac.newRole({
  apiKey: ["create", "read", "update", "delete"],

  project: ["create", "update"],

  projectApiKey: ["create", "read", "update", "delete"],

  ...adminAc.statements,

  invitation: [...adminAc.statements.invitation, "read"],
});

const owner = ac.newRole({
  apiKey: ["create", "read", "update", "delete"],

  project: ["create", "update", "delete"],

  projectApiKey: ["create", "read", "update", "delete"],

  ...ownerAc.statements,

  invitation: [...ownerAc.statements.invitation, "read"],
});

export const roles = {
  admin,
  member,
  owner,
};
