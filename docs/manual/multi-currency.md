# Multi-currency and period-end revaluation

## Base currency and document currency

Your books are kept in one **base currency**, chosen in the setup wizard. A quote, invoice, order or bill can be in another currency. The document carries an exchange rate: units of base currency for one unit of document currency. Example: base EUR, invoice in USD, 1 USD = 0.92 EUR, rate 0.92.

The invoice is posted to the ledger in the base currency, at the rate on the document date.

## Where rates come from

The program looks for a rate in this order:

1. A stored **rate set** that applies to the date. You can enter your own rate set by hand and lock it so it cannot change.
2. The cache of the last downloaded rates.
3. A rate table that ships with the program. It lets the program work offline. Its rates are old by definition.

Downloaded rates come from the European Central Bank daily reference feed. The currencies screen is at `/fx`. The program tells you which of the three sources it used.

Use your own rate set if your accountant requires a fixed monthly rate.

## Payments in a foreign currency

When a foreign-currency invoice is paid, the bank side is booked in the base currency at the rate of the payment date. The open item is cleared at the rate of the invoice date. The difference is booked as a **realised** exchange gain or loss.

Accounts used for it:

| Chart | Gain | Loss |
|---|---|---|
| SKR03 | 2660 | 2150 |
| IFRS | 4300 | 5700 |

The payment needs a rate for its date. If none can be found, the program stops with a message.

## Period-end revaluation

At the end of a period, open foreign-currency invoices and bills still carry the old document rate. Revaluation restates them at the closing rate.

1. Open **Accounting** and find the **FX revaluation** panel.
2. Pick the period. The closing date is filled in.
3. Check the closing rate per currency. Overwrite it if you use another rate.
4. Choose **Preview**. The table shows each open item: booked amount, revalued amount and the gain or loss.
5. Choose **Post revaluation**.

The program posts one entry on the closing date as an **unrealised** gain or loss. It posts the reversal on the first day of the next period. When the invoice is paid later, the payment is settled against the original document rate, as described above. The two entries cancel out.

Rules:

- A revaluation can be posted once per closing date. A second attempt is refused.
- The chart of accounts needs the gain and loss accounts. If they are missing, the program says so.
- Items included are issued invoices and posted bills in a foreign currency, with an open amount on the closing date. Payments made after that date count as still open.
- A closed period cannot receive postings. Post the revaluation before you close it. See [Roles and audit log](roles-audit.md) for who may close periods.

## A different tool: movement analysis

The FX module also has a calculator that splits a change in a reported figure into the part caused by volumes and the part caused by exchange rates. It is for reports and does not post anything.
