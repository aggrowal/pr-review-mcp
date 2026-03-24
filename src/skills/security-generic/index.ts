import type { SkillMetadata, DiffContext, DetectedContext } from "../../types.js";

export const metadata: SkillMetadata = {
  id: "security-generic",
  name: "Security (generic)",
  description:
    "Secrets, injection, auth/authz, session/token handling, crypto, " +
    "SSRF, deserialization, resource lifecycle, data exposure, supply chain.",
  requires: {
    language: ["*"],
    framework: ["*"],
  },
  produces: "security",
};
export function buildPrompt(_diff: DiffContext, ctx: DetectedContext): string {
  return `You are reviewing code for **security vulnerabilities** in a ${ctx.language} project.
Use the shared changed-files payload from the parent prompt. Focus on added/modified behavior.

## What to check

### A. Secrets and Sensitive Data Exposure

1. **Hardcoded secrets** -- API keys, passwords, tokens, private keys, connection strings, or webhook URLs committed in source. (CWE-798, OWASP A02)
2. **Secrets leaked through logs or errors** -- sensitive values written to console, log files, or error messages returned to callers. (CWE-532, OWASP A09)
3. **Secrets in URLs or query strings** -- tokens, keys, or session IDs passed as URL parameters where they end up in browser history, referrer headers, or access logs. (ASVS 14.2.1)
4. **Insecure secret storage** -- credentials stored in plaintext config files, environment variables logged at startup, or secrets baked into build artifacts/Docker layers. (CWE-312, OWASP A05)
5. **Missing secret rotation or expiry posture** -- long-lived static secrets with no documented rotation, or tokens issued without expiration. (ASVS 13.3.4)
6. **Sensitive data overexposure** -- API responses returning more fields than the caller needs, missing response filtering, caching sensitive data without no-store headers, or leaking PII in metadata. (CWE-200, OWASP A01/API3)

### B. Authentication

7. **Missing authentication on sensitive routes** -- endpoints that mutate state, access private data, or perform admin actions without requiring a verified identity. (CWE-306, OWASP A07)
8. **Weak password storage or recovery** -- passwords stored with fast hashes (MD5/SHA1/SHA256 without KDF), missing salts, or recovery flows that leak account existence. (CWE-916, OWASP A02)
9. **Session fixation and session-id reuse** -- session tokens not regenerated after login, session IDs exposed in URLs, or missing Secure/HttpOnly/SameSite cookie attributes. (CWE-384, OWASP A07)
10. **Session and token invalidation gaps** -- missing logout invalidation, no absolute session timeout, or stale sessions surviving password changes. (ASVS 7.4)
11. **JWT and self-contained token validation failures** -- missing signature verification, accepting the "none" algorithm, not validating aud/iss/exp/nbf claims, or key-confusion between symmetric and asymmetric algorithms. (CWE-347, ASVS 9.1-9.2)

### C. Authorization and Access Control

12. **Missing function-level authorization** -- admin or privileged actions reachable by unprivileged callers because role/permission checks are absent or bypassed. (CWE-862, OWASP A01/API5)
13. **BOLA / IDOR** -- object-level authorization gaps where manipulating an ID in a request grants access to another user's resources. (CWE-639, API1)
14. **BOPLA / mass assignment** -- accepting untrusted input to set fields the caller should not control (e.g., isAdmin, price, role) without an explicit allowlist. (CWE-915, API3)
15. **Cross-tenant isolation violations** -- queries or operations that do not scope data to the current tenant, allowing one tenant to read or modify another's data. (ASVS 8.4.1)

### D. Injection

16. **SQL injection** -- string concatenation or template literals used to build SQL queries instead of parameterized queries or prepared statements. (CWE-89, OWASP A03)
17. **NoSQL and ORM injection** -- unsanitized user input passed as query operators ($gt, $ne) or raw HQL/JPQL fragments. (CWE-943)
18. **OS command injection** -- user-controlled values interpolated into shell commands, child_process calls, or system() without validation. (CWE-78, OWASP A03)
19. **Template and code injection** -- eval(), exec(), Function(), new AsyncFunction(), server-side template injection via user input in template strings, or dynamic code generation from untrusted data. (CWE-94)
20. **XSS and output-encoding failures** -- user input rendered into HTML, JavaScript, or DOM without context-appropriate escaping; dangerouslySetInnerHTML with unsanitized content. (CWE-79, OWASP A03)
21. **Header, CRLF, and log injection** -- user input embedded in HTTP headers, redirect URLs, or log messages without neutralizing CR/LF characters. (CWE-113, CWE-117)

### E. SSRF, Path Traversal, and File Handling

22. **SSRF** -- server-side requests where the destination URL, hostname, or IP is derived from user input without allowlist validation, enabling access to internal services or cloud metadata endpoints (169.254.169.254). (CWE-918, OWASP A10)
23. **Open redirect** -- user-controlled redirect targets that are not validated against an allowlist, enabling phishing via a trusted domain. (CWE-601)
24. **Path traversal** -- user-controlled file paths used in file reads, writes, or includes without canonicalization and directory-scope enforcement (../ sequences). (CWE-22, OWASP A01)
25. **Unrestricted file upload** -- accepting file uploads without validating type, size, or content; storing uploads in executable locations; or missing anti-virus scanning. (CWE-434, ASVS 5.2)

### F. Cryptography

26. **Weak crypto primitives or modes** -- MD5/SHA1 used for integrity or authentication; ECB block cipher mode; DES/3DES; RSA without OAEP; PKCS#1 v1.5 padding. (CWE-327, OWASP A02)
27. **Non-cryptographic randomness for security** -- Math.random(), random.random(), rand() used to generate tokens, session IDs, nonces, or CSRF tokens instead of a CSPRNG. (CWE-338)
28. **Static or reused IV/nonce** -- initialization vectors hardcoded, reused across encryptions, or derived predictably. (CWE-329)
29. **Missing TLS verification or insecure transport** -- disabling certificate validation (rejectUnauthorized: false, verify=False), downgrading to HTTP, or using STARTTLS without enforcement. (CWE-295, OWASP A02)

### G. Deserialization and Parser Safety

30. **Unsafe deserialization** -- deserializing untrusted data with pickle, Java ObjectInputStream, yaml.load (without SafeLoader), PHP unserialize, or .NET BinaryFormatter without type restrictions. (CWE-502, OWASP A08)
31. **XML external entity (XXE) processing** -- parsing XML from untrusted sources with external entity resolution or DTD processing enabled. (CWE-611)

### H. Resource Lifecycle and Availability

32. **Connection and handle leaks** -- database connections, file descriptors, HTTP clients, or sockets opened but not closed in all exit paths (including error/exception branches), leading to pool exhaustion under load. (CWE-772, CWE-404)
33. **Unbounded resource allocation** -- missing limits on request body size, query result sets, file upload size, retry counts, thread/connection pool sizes, or recursive depth, enabling denial-of-service. (CWE-770, API4)
34. **Fail-open under resource exhaustion** -- error handlers that skip authorization checks, disable rate limits, or grant default access when a backing service (database, cache, auth provider) is unavailable. (CWE-636)

### I. Configuration and Supply Chain

35. **Security misconfiguration** -- debug mode enabled in production, default credentials, overly permissive CORS (origin: *), missing security headers (CSP, HSTS, X-Content-Type-Options), directory listing enabled, or exposed stack traces. (OWASP A05)
36. **Vulnerable or untrusted dependencies** -- importing packages from non-default registries, pinning to known-vulnerable versions, disabling integrity checks, or using unmaintained libraries with open CVEs. (CWE-1104, OWASP A06)

## Rules

- Only flag issues with a **realistic attack vector**. Do not flag theoretical concerns that have no plausible exploitation path in context.
- For each finding, describe the specific attack scenario in 1-2 sentences.
- For each finding, include a specific file and line range from the shared changed-files payload.
- Reference the relevant standard (CWE/OWASP/ASVS) when applicable.
- Positive findings are encouraged when the code demonstrates good security practices (parameterized queries, input validation, proper key management, etc.).
- Do not report issues that depend on unchanged code you cannot validate from the provided payload.`;
}
