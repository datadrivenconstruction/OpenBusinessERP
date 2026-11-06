# Roles and audit log

## Roles

Each user has one role. The role applies to the whole program. There are four built-in roles, each one including everything below it.

| Role | Can do |
|---|---|
| Viewer | Read everything. Change nothing. |
| Editor | Create and edit drafts: quotes, orders, invoices (as drafts), bills, contacts, products, stock movements, CRM records. Import bank statements. Write dunning letters. |
| Manager | Everything an editor can do, plus post to the ledger and change setup: issue invoices, record payments, post bills, confirm bank matches, close accounting periods, post FX revaluation, import data, delete CRM records, see the audit log and the user list. |
| Admin | Everything. Create, change and delete users. Export and restore backups. Delete audit entries. |

The exact permission names are in the code. Examples: `sales.post` (issue invoices and record payments) needs Manager. `sales.write` (drafts) needs Editor. `gl.manage` (close periods) needs Manager. `backup.admin` needs Admin.

A typical small business:

- Owner: Admin.
- Bookkeeper or accountant: Manager.
- Sales staff: Editor.
- External adviser who only looks: Viewer.

### Manage users

Open **Users** (`/users`) as an administrator. Create a user with name, email, password and role. Deactivate users who leave. Do not share logins. The audit log depends on one person per account.

The first account registered on a fresh install becomes Admin. If you need to make an existing user an admin from the command line, run `openbusinesserp promote-admin <email>`.

## Audit log

Every create, change and delete on a business record is logged: who, when, what, and a before-and-after summary of the changed fields. This happens inside the program for all business modules, so new features cannot forget it. Workflow actions such as post, send and reconcile are labelled by the request that caused them.

Open **Audit log** (`/admin/audit-log`). You need the Manager role. You can filter and look at one record's history. The detail view of invoices and bills also has an activity list.

What to know:

- The log shows what the program did through its own screens and API. It does not show changes made directly in the database.
- Posted ledger entries are not edited. A correction is a reversal or a new entry. That is part of the audit trail.
- IP addresses and browser strings in the log are cleared after a retention period (180 days by default). The record of who changed what is kept.
- Only an Admin can delete or redact audit entries. Redacting is meant for data-protection requests.
- The log is not a substitute for a backup.
