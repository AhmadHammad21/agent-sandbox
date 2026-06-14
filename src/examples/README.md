# Examples

End-to-end integration patterns for agent-sandbox.

| Example | What it shows |
|---------|---------------|
| [`basic-session.ts`](./basic-session.ts) | Provision a tenant, run two agent turns in one conversation, and observe sandbox + conversation state persisting across turns. Run with `bun run example`. |

## HTTP usage

Once the API server is running (`bun run dev`), drive it over HTTP:

```bash
# Provision a tenant (admin key)
curl -s -X POST localhost:8080/tenants \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"id":"acme","name":"Acme Inc"}'
# → { "id": "acme", "api_key": "ten_...", ... }

# Run an agent turn (tenant key from the response above)
curl -s -X POST localhost:8080/session \
  -H "authorization: Bearer ten_..." \
  -H "content-type: application/json" \
  -d '{"message":"Write a python script that prints the first 10 primes and run it."}'
# → { "reply": "...", "conversationId": "..." }

# Continue the same conversation by passing conversationId back.
```
