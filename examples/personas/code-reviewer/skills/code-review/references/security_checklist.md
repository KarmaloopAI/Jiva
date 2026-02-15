# Security Checklist for Code Review

## Authentication & Authorization

- [ ] **Password Storage**: Passwords hashed with strong algorithm (bcrypt, Argon2)
- [ ] **No Hardcoded Credentials**: API keys, passwords not in source code
- [ ] **Session Management**: Secure session tokens, proper timeout
- [ ] **Authorization Checks**: Verify user permissions before operations
- [ ] **Token Security**: JWT properly signed and validated
- [ ] **OAuth/OIDC**: Proper implementation of flows

## Input Validation

- [ ] **SQL Injection**: Parameterized queries, no string concatenation
- [ ] **XSS Prevention**: Output encoding, CSP headers
- [ ] **Path Traversal**: Validate file paths, use allowlists
- [ ] **Command Injection**: Avoid `eval()`, `exec()`, shell command strings
- [ ] **CSRF Protection**: Anti-CSRF tokens on state-changing operations
- [ ] **File Uploads**: Validate file types, limit sizes, scan for malware

## Data Protection

- [ ] **Sensitive Data**: No sensitive data in logs or error messages
- [ ] **Encryption**: Use TLS for data in transit
- [ ] **Data at Rest**: Encrypt sensitive databases/files
- [ ] **PII Handling**: Comply with GDPR/CCPA requirements
- [ ] **API Keys**: Store in environment variables or secret management systems

## Common Vulnerabilities

### SQL Injection
❌ **Bad:**
```javascript
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

✅ **Good:**
```javascript
const query = 'SELECT * FROM users WHERE id = ?';
db.execute(query, [userId]);
```

### XSS
❌ **Bad:**
```javascript
element.innerHTML = userInput;
```

✅ **Good:**
```javascript
element.textContent = userInput;
// or use a proper sanitization library
```

### Command Injection
❌ **Bad:**
```javascript
exec(`rm -rf ${userPath}`);
```

✅ **Good:**
```javascript
const path = require('path');
const safePath = path.normalize(userPath);
if (safePath.startsWith('/safe/directory/')) {
  fs.rm(safePath, { recursive: true });
}
```

## Dependency Security

- [ ] **Audit Dependencies**: Run `npm audit` or equivalent regularly
- [ ] **Keep Updated**: Update dependencies for security patches
- [ ] **Check Licenses**: Ensure compatible licenses
- [ ] **Minimize Dependencies**: Reduce attack surface

## API Security

- [ ] **Rate Limiting**: Prevent abuse and DDoS
- [ ] **Input Validation**: Validate all API inputs
- [ ] **Authentication**: Require auth for sensitive endpoints
- [ ] **CORS Configuration**: Properly configured CORS headers
- [ ] **API Versioning**: Support backward compatibility

## Error Handling

- [ ] **No Stack Traces**: Don't expose stack traces to users
- [ ] **Generic Errors**: Return generic error messages externally
- [ ] **Detailed Logging**: Log detailed errors server-side only
- [ ] **Fail Securely**: Default to secure state on errors

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
