# Dunning

Dunning is the process of reminding customers about overdue invoices. The program prepares the letters. You decide what leaves the building.

![Receivables aging and dunning](../images/receivables.png)

## Aging

**Receivables** (`/receivables`) lists all open invoices (issued or partially paid) in aging buckets by days overdue:

| Bucket | Days overdue |
|---|---|
| Current | not yet due |
| 1-30 | 1 to 30 |
| 31-60 | 31 to 60 |
| 61-90 | 61 to 90 |
| 90+ | more than 90 |

A statement PDF per customer lists their open items.

## Dunning levels

A level defines when a letter is due and what it says. The defaults in English are:

| Level | Name | Days after due date |
|---|---|---|
| 1 | Reminder | 7 |
| 2 | First notice | 21 |
| 3 | Second notice | 35 |

German texts are included as well. You can rename levels, change the days, set a fee per level and write your own subject and body. Texts accept these placeholders: `{customer}`, `{number}`, `{doc_date}`, `{due_date}`, `{outstanding}`, `{currency}`, `{days_overdue}`, `{fee}`, `{interest}`, `{total}`.

## Fees and interest

Both are **off by default**. If you switch them on:

- A fee is added per level, as you set it.
- Interest is computed with the rate in percent that you enter. The program does not look up a legal rate. For Germany, the statutory default interest is the base rate plus 5 points (consumers) or 9 points (businesses). Check the current figures and what you may charge with your adviser.

The setting "minimum days between letters" (default 7) stops two letters going out for one invoice in quick succession.

## The routine

1. Open Receivables and choose **Dunning run**. The program shows a **preview** of which invoices reached which level.
2. Start the run. It creates **draft letters**. Nothing is sent.
3. Open each letter. Edit the text if needed. **Approve** or **discard** it.
4. **Send** the approved letters. The email goes out with the invoice PDF attached. The letter is marked sent only if the mail was accepted by the mail server. A failed send stays visible.
5. Letters for customers without an email address are printed and delivered by hand. The program only creates them.

Do this weekly. It takes a few minutes.

## Blocking a customer

Put a customer on the **block list** if they must not get letters, for example during a dispute or an agreed payment plan. Add a reason. Remove the block later.

## Follow-ups

Use follow-ups to note a phone call or a promise to pay ("pays on the 15th"), with a date. They are your memory between runs.

## What dunning does not do

- It does not post any ledger entry. Fees and interest appear on the letter. If you want to invoice them, create an invoice or a note yourself.
- It does not send anything without a person pressing send.
- Legal requirements for reminders differ by country and by customer type. The default texts are a starting point.
