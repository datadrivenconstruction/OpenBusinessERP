# Email and PDF templates

## Outgoing mail

The program sends invoices, quotes and reminders by SMTP. Set it up once under **Settings > Outgoing mail** (also step 5 of the setup wizard). Enter host, port, user, password and the sender address. The password is stored encrypted and is never shown again.

Send yourself a test mail first.

!!! warning "Server settings win"
    If the server is configured with `EMAIL_BACKEND=smtp` and `SMTP_HOST` in the environment, those values override what you enter in Settings. Without `EMAIL_BACKEND=smtp`, the default `console` transport only writes messages to the log. Nothing leaves the machine and nothing reports an error. The [email setup note](https://github.com/datadrivenconstruction/OpenBusinessERP/blob/main/docs/email-setup.md) lists every setting.

## Email text

When you send a document, the program opens a draft: recipient, subject, body and the PDF as attachment. You can edit all of it before sending.

Defaults come from the document language. You can set your own subject and body per document type (quote, order, invoice, credit note) in **Settings > Company details & documents**, under "Default texts per document type". Write placeholders in curly braces:

| Placeholder | Becomes |
|---|---|
| `{customer_name}` or `{customer}` | Customer name |
| `{document_title}` | "Invoice", "Quote" and so on, in the document language |
| `{document_number}` or `{number}` | Document number |
| `{document_date}` | Document date |
| `{due_date}` | Due date |
| `{total}` | Gross total with currency |
| `{balance_due}` | Open amount with currency |
| `{company_name}` or `{company}` | Your company name |

Unknown placeholders stay as you typed them. Check one real draft before you rely on a new text.

Example:

```text
Subject: {document_title} {number} from {company}

Dear {customer},

please find {document_title} {number} attached. The amount of {total} is due on {due_date}.
```

## PDF design

In **Settings > Document design** you choose how quotes, orders and invoices look.

| Option | Choices |
|---|---|
| Template | classic, modern, compact |
| Accent colour | any hex colour, for example `#1f3a5f` |
| Font | DejaVu Sans, Helvetica, Times |
| Logo | position left, centre or right; size small, medium or large |
| Footer blocks | address, contact, legal, bank |
| Other | page numbers, DIN 5008 layout, fold marks, terms text |

A preview shows the result before you save.

Documents can be issued in a language other than the one you work in. Set the language on the document.

EUR invoices carry an EPC (SEPA) QR code when an IBAN is set. You can switch this off.

## E-invoice XML

For invoices the program can also produce CII XML. A file that validates against the schema is not certified by any tax authority. Check the file with the system your customer or authority uses. See [FAQ](faq.md).
