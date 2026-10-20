---
"@podosoft/podokit": minor
"@podosoft/podokit-contracts": minor
"@podosoft/podokit-api-client": minor
---

Add organization teams. The authentication module mounts Better Auth's organization teams (organizations start without a team, and the last team can be removed), and a new `teams` setting, off by default and seeded by a migration, gates their endpoints: while it or `organization` is off, they answer 404. The admin Settings page has a **Teams** switch, and the admin organizations page has a **Teams** dialog that lists, creates, renames, and deletes teams and adds or removes members chosen from the organization's members. `Capabilities` gains `teams`, the API client types the team methods, and `GET /account/team-members` lists a team's members for any member of its organization, since Better Auth's own listing answers only members of the team. Organization managers can manage teams. Existing applications get the `team` and `teamMember` tables from `migrate:all`; the owned organizations and settings pages show the new controls once they are regenerated or edited to render them.
