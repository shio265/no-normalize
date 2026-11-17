# Security Policy

## Supported versions

Security fixes focus on the **latest release** of No Normalize. Older versions are not guaranteed to receive separate patches; update to the latest release whenever possible.

## Reporting a vulnerability

**Do not post vulnerability details, exploit code, or sensitive information in public issues, pull requests, or discussions.**

Prefer private reporting through GitHub:

1. Open the repository's **Security → Advisories → Report a vulnerability** page, if private vulnerability reporting is enabled.
2. Include the information listed below.

If private reporting is unavailable, contact the maintainer through a contact method listed on their GitHub profile.

### What to include

- The affected extension version or commit.
- Your browser, browser version, and operating system.
- Installation method: CRX, Load unpacked, or a development environment.
- A description of the issue, exploitation requirements, and potential impact.
- Reproduction steps or a minimal proof of concept.
- Relevant logs, screenshots, or suggested fixes, if available.

Redact or remove tokens, cookies, CRX signing keys, account information, and personal data before submitting your report. Never send private `.pem` keys, even in a private report.

## Scope

Potential security issues include:

- Unintended code execution or injection into a page or popup.
- Insufficient message validation between the MAIN world, ISOLATED world, and extension.
- Misuse of extension permissions, unauthorized data access, or data exposure beyond the required scope.
- Dependency vulnerabilities that affect the extension in practice.
- Exposed CRX signing keys, CI tokens, or weaknesses in the build and release process.

UI bugs, incorrect normalization statistics, and ordinary audio issues can be reported in public issues, provided they contain no sensitive information. If you are unsure whether an issue is security-related, report it privately first.

## Responsible disclosure

- Test only on devices, accounts, and environments you own or are authorized to assess.
- Do not access other people's data, disrupt services, or distribute modified extension builds for exploitation.
- Coordinate with the maintainer and wait for a fix or mitigation guidance before publishing exploit details.
- Handling time depends on severity and reproducibility. The project does not guarantee fixed response or patch timelines.

## Safe downloads and installation

- Download builds only from project sources you trust. Do not install CRX or ZIP files redistributed by unknown sources.
- The extension has not been published on an extension store, and some browsers may block self-signed CRX files. Do not disable browser security protections to force installation.
- Use `SHA256SUMS` to check downloaded files. `MD5SUMS` helps detect data corruption, but is not protection against tampering. Checksums downloaded alongside a file do not independently authenticate the publisher.
- Do not share CRX signing keys. If you suspect a key or token has been exposed, report it privately to the maintainer as soon as possible without reposting the secret value.
