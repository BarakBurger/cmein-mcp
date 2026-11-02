# Security

This server is an OAuth resource server for cmein.com. It holds no secrets, mints no tokens and
stores nothing about the people who use it. Account tools verify each token against cmein.com's
published signing keys and check that it was issued for `https://mcp.cmein.com/mcp`.

## Reporting a vulnerability

Please report privately, not in a public issue:

- **GitHub:** the **Security** tab of this repository, **Report a vulnerability**
- **Email:** support@cmein.com, with "Security" in the subject

Include what you found, how to reproduce it and what it lets an attacker do. We answer within a few
working days and will tell you when it is fixed.

## In scope

- this server's code, and the hosted instance at `https://mcp.cmein.com/mcp`
- how it verifies tokens and scopes, and what the account tools can reach

Issues in cmein.com itself can be reported the same way.
