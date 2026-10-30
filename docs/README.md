# OpenBusinessERP documentation

OpenBusinessERP is an open, self-hosted ERP for small and medium businesses: sales and CRM, products and stock, purchasing, accounting and VAT, bank reconciliation, receivables and dunning, appointments and online booking, data import and industry packs. It is modular, so you enable only the parts you need.

## Install and run

- [Getting started](./getting-started.md) - desktop app, `pip install` or Docker, and the demo login.
- [Linux install guide](./INSTALL_LINUX.md) - set up on a server.
- [Desktop install guide](./desktop/INSTALL.md) - set up on a workstation.
- [Desktop remote server](./desktop/REMOTE_SERVER.md) - point desktop installations at one server your organisation already runs.
- [Autostart templates](./install/autostart/README.md) - systemd, launchd and Windows service.
- [Email and SMTP setup](./email-setup.md) - outbound mail for password resets, documents and notifications.
- [Backup freshness monitoring](./backup-monitoring.md) - detect a backup that quietly stopped.
- Windows and macOS signing: [Windows blocks the app](./desktop/WINDOWS_BLOCKED.md), [Windows signing](./desktop/WINDOWS_SIGNING.md), [macOS notarization](./desktop/MACOS_NOTARIZATION.md), [release signature inventory](./desktop/RELEASE_SIGNATURE_INVENTORY.md).

## Build on the platform

- [Platform and builder guide](./platform/README.md) - the module loader, manifests, events, hooks and the first-module tutorial.
- [Module development quickstart](./module-development/quickstart.md) - zero to a running module in about ten minutes.
- [Frontend module development guide](../frontend/src/modules/MODULE_DEVELOPMENT_GUIDE.md) - the React side of a module.
- [Architecture](./architecture/README.md) and [overview](./architecture/OVERVIEW.md) - how the pieces fit together.
- [API](./api/README.md) - REST conventions. A running instance also publishes an interactive OpenAPI reference at `/docs`.

## Legal and compliance

- [Privacy](./legal/PRIVACY.md), [Terms](./legal/TERMS.md), [Cookies](./legal/COOKIES.md), [Accessibility](./legal/ACCESSIBILITY.md)
- [Commercial license](./legal/COMMERCIAL-LICENSE.md), [Patents](./legal/PATENTS.md), [Third-party licenses](./legal/THIRD_PARTY_LICENSES.md), [Acknowledgments](./legal/ACKNOWLEDGMENTS.md)
- [Record of processing activities template](./compliance/ROPA_template.md)
