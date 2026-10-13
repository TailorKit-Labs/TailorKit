import { db, issues, teamMembers, teams, users } from "../src/db";

const seedUsers = [
  { id: "alex", name: "Alex Morgan", email: "alex@playground.local", avatar: "AM" },
  { id: "sam", name: "Sam Rivera", email: "sam@playground.local", avatar: "SR" },
  { id: "jules", name: "Jules Park", email: "jules@playground.local", avatar: "JP" },
];
const seedTeams = [
  { id: "team-northstar", name: "Northstar", key: "NORTH" },
  { id: "team-studio", name: "Studio", key: "STUDIO" },
];

db.insert(users).values(seedUsers).onConflictDoNothing().run();
db.insert(teams).values(seedTeams).onConflictDoNothing().run();
db.insert(teamMembers)
  .values([
    { userId: "alex", teamId: "team-northstar", role: "owner" },
    { userId: "sam", teamId: "team-northstar", role: "member" },
    { userId: "jules", teamId: "team-studio", role: "owner" },
    { userId: "alex", teamId: "team-studio", role: "member" },
  ])
  .onConflictDoNothing()
  .run();

const seedIssues = [
  {
    id: "issue-101",
    key: "NORTH-1",
    teamId: "team-northstar",
    title: "Add a compact issue view",
    description: "Let teammates scan an issue without leaving the list.",
    status: "In Progress" as const,
    createdBy: "alex",
    createdAt: new Date("2026-10-10T09:00:00Z"),
  },
  {
    id: "issue-102",
    key: "NORTH-2",
    teamId: "team-northstar",
    title: "Collect feedback from the team",
    description: "Add a simple place to capture the next round of feedback.",
    status: "Backlog" as const,
    createdBy: "sam",
    createdAt: new Date("2026-10-11T12:30:00Z"),
  },
  {
    id: "issue-103",
    key: "NORTH-3",
    teamId: "team-northstar",
    title: "Polish the first run experience",
    description: "Make the first project feel useful before any setup.",
    status: "Done" as const,
    createdBy: "alex",
    createdAt: new Date("2026-10-12T08:15:00Z"),
  },
  {
    id: "issue-201",
    key: "STUDIO-1",
    teamId: "team-studio",
    title: "Plan the next design review",
    description: "Gather the open questions before the review.",
    status: "Backlog" as const,
    createdBy: "jules",
    createdAt: new Date("2026-10-09T08:30:00Z"),
  },
];
db.insert(issues).values(seedIssues).onConflictDoNothing().run();

process.stdout.write("Seeded the playground profiles, teams, and issues.\n");
