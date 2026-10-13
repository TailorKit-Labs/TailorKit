import { db, issues, teamMembers, teams, users } from "../src/db";

const seedUsers = [
  {
    avatar: "AM",
    email: "alex@playground.local",
    id: "alex",
    name: "Alex Morgan",
  },
  {
    avatar: "SR",
    email: "sam@playground.local",
    id: "sam",
    name: "Sam Rivera",
  },
  {
    avatar: "JP",
    email: "jules@playground.local",
    id: "jules",
    name: "Jules Park",
  },
];
const seedTeams = [
  { id: "team-northstar", key: "NORTH", name: "Northstar" },
  { id: "team-studio", key: "STUDIO", name: "Studio" },
];

db.insert(users).values(seedUsers).onConflictDoNothing().run();
db.insert(teams).values(seedTeams).onConflictDoNothing().run();
db.insert(teamMembers)
  .values([
    { role: "owner", teamId: "team-northstar", userId: "alex" },
    { role: "member", teamId: "team-northstar", userId: "sam" },
    { role: "owner", teamId: "team-studio", userId: "jules" },
    { role: "member", teamId: "team-studio", userId: "alex" },
  ])
  .onConflictDoNothing()
  .run();

const seedIssues = [
  {
    createdAt: new Date("2026-10-10T09:00:00Z"),
    createdBy: "alex",
    description: "Let teammates scan an issue without leaving the list.",
    id: "issue-101",
    key: "NORTH-1",
    status: "In Progress" as const,
    teamId: "team-northstar",
    title: "Add a compact issue view",
  },
  {
    createdAt: new Date("2026-10-11T12:30:00Z"),
    createdBy: "sam",
    description: "Add a simple place to capture the next round of feedback.",
    id: "issue-102",
    key: "NORTH-2",
    status: "Backlog" as const,
    teamId: "team-northstar",
    title: "Collect feedback from the team",
  },
  {
    createdAt: new Date("2026-10-12T08:15:00Z"),
    createdBy: "alex",
    description: "Make the first project feel useful before any setup.",
    id: "issue-103",
    key: "NORTH-3",
    status: "Done" as const,
    teamId: "team-northstar",
    title: "Polish the first run experience",
  },
  {
    createdAt: new Date("2026-10-09T08:30:00Z"),
    createdBy: "jules",
    description: "Gather the open questions before the review.",
    id: "issue-201",
    key: "STUDIO-1",
    status: "Backlog" as const,
    teamId: "team-studio",
    title: "Plan the next design review",
  },
];
db.insert(issues).values(seedIssues).onConflictDoNothing().run();

process.stdout.write("Seeded the playground profiles, teams, and issues.\n");
