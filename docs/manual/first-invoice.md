# Set up and send your first invoice

The setup wizard at `/setup` takes you from an empty install to an issued invoice. It has six steps. Every step can be skipped. Your progress is saved in the business settings, so you can stop and continue from another browser.

Skipped steps appear as a checklist on the dashboard ("Finish setting up").

If you only want to look around, choose **Load demo company instead** in the wizard.

## The six steps

### 1. Your company

| Field | Notes |
|---|---|
| Company name | Printed on every document. |
| Country | Sets default formats and the VAT rates offered in the next step. |
| Address | Printed on documents. An invoice cannot be issued without a seller address. |
| Currency | The base currency of your books. Choose it carefully. Changing it later is not simple. |
| Chart of accounts | IFRS (international) or SKR03 (Germany). |

A line below the fields shows how numbers and dates will look, for example `1.234,56` and `31.12.2026`.

### 2. Tax and VAT

- **VAT ID**: required on an invoice unless you are a small business.
- **Small business**: tick this if you do not charge VAT. The wizard shows the legal reference for your country. Invoices then carry a note instead of VAT.
- **VAT rates**: add, remove and mark one as default. The default is used on new lines.

### 3. Bank account

Enter the account name, IBAN, BIC and bank name. You can enter an opening balance. With an IBAN, invoices carry an EPC QR code. A customer can scan it with their banking app to pay.

### 4. Logo and document defaults

Upload a PNG or JPEG logo. Set the payment terms in days and the invoice number prefix. The wizard shows the next number, for example `INV-000001`. Without a prefix of your own, invoices use `INV`.

### 5. Outgoing mail

Enter your SMTP server details so the program can email invoices. The wizard stores the password encrypted. You can skip this step and download PDFs instead. See also [Email and PDF templates](templates.md).

### 6. First customer and invoice

Enter the customer name, email and address, then choose **Create draft and preview PDF**. Read the preview. If it is right, choose **Issue invoice**.

Issuing does two things:

1. It locks the invoice. Only drafts can be edited or deleted. To correct an issued invoice, you cancel it or issue a credit note.
2. It posts the invoice to the ledger: receivable on the debit side, revenue and VAT on the credit side.

The number is assigned when the draft is created, from a counter that only goes up.

You then see "Invoice ... issued and posted." Choose **Go to dashboard**.

![A paid invoice with line items, totals, payments and activity](../images/invoice.png)

## When the program refuses to issue

Before issuing, the program checks the mandatory invoice data. It lists what is missing: seller name, seller address, tax number or VAT ID, customer name, customer address, invoice date and invoice number. Fix the items and try again. The checks are a help and not legal advice. Your country may require more.

## Change the settings later

Everything from the wizard is under **Settings** in the sidebar.

![Settings hub](../images/settings.png)

## Bring in existing data

Use **Import** (`/import`) to load customers, suppliers, products, opening balances, open invoices and open bills from CSV or XLSX files. The wizard has these steps: upload, map columns, validate, import. Validation is a dry run. Nothing is written until you import. An import can be undone.

![Data import wizard](../images/import.png)
