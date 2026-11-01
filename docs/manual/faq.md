# FAQ

## General

**Does it cost anything?**
No. The software is free under the AGPL-3.0. There are no per-user fees. If you change it and offer it to others over a network, you must publish your changes under the same license. A commercial license is available on request.

**Is there a hosted version?**
No. You run it yourself.

**How many languages?**
The interface has 45 language bundles, including right-to-left languages. Quotes and invoices can be issued in the customer's language, independent of the language you work in.

**Do I need the AI features?**
No. The AI chat is optional and needs your own API key. Everything else works without it.

## Accounting

**Which charts of accounts are included?**
SKR03 (Germany) and a generic IFRS-style chart. You can add, rename and deactivate accounts afterwards.

**Is the bookkeeping double-entry?**
Yes. Issuing an invoice, posting a bill, recording a payment and confirming a bank match all create ledger entries. Posted entries are not edited. You reverse them.

**Can I close a period?**
Yes. A Manager can close an accounting period. A closed period accepts no postings. Post your period-end entries, such as [FX revaluation](multi-currency.md), before you close.

**Is the program approved by the tax authority?**
No. Nothing in it is certified. DATEV and SAF-T files are generated as a convenience. See [DATEV and SAF-T export](accountant-export.md).

**Does it do e-invoicing?**
It exports CII XML. Schema-valid is not the same as accepted. Check the file against the rules that apply to you, and against the receiving system, before you depend on it.

## Data

**How do I move my data in?**
Use the import wizard for customers, suppliers, products, opening balances, open invoices and open bills. Export these lists from your current tool as CSV or XLSX. Map the columns, look at the validation result, then import. An import can be undone.

**Where is my data?**
In a PostgreSQL database and a data directory on your own machine or server. Nothing is sent to us. The AI chat sends your questions to the provider whose key you entered, if you use it.

**How do I get my data out?**
Take a database dump ([Backup and restore](backup.md)). Lists can be exported as files. Accountants get DATEV or SAF-T files.

## Problems

**Emails are not arriving.**
Check that the server runs with `EMAIL_BACKEND=smtp`. The default `console` transport writes to the log and sends nothing. Then send a test mail from Settings. See [Email and PDF templates](templates.md).

**I cannot issue an invoice.**
The program lists the missing data: seller address, tax number or VAT ID, customer address and so on. Fix these and issue again.

**An issued invoice has an error.**
You cannot edit it. Cancel it, or issue a credit note and a new invoice.

**A bank line has no suggestion.**
Check that the invoice is issued and open, that the amount is right and that the bank account is the one you imported into. Book the line manually if needed.

**Windows blocks the installer.**
The installer is not signed yet. Follow the [desktop guide](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/docs/desktop/INSTALL.md).

**I forgot the admin password.**
On a pip or source install, an existing user can be promoted with `openbusinesserp promote-admin <email>` when no admin is left. The password reset uses email, so set up mail first.

**Where do I report a bug?**
On [GitHub Issues](https://github.com/datadrivenconstruction/OpenBusinessERP/issues). Give the version, what you did, what you expected and what happened.
