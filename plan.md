# Plan

## Status
- Real image assets from LUMINZU are served publicly and linked in the WhatsApp flow.
- Gemini system prompt and generation settings are aligned to the dental bot behavior.
- History sanitization hardening is in place to prevent malformed JSON from poisoning future turns.

## Next steps
- Commit the final hardening fix for the Gemini sanitization export path.
- Push the branch to origin/main and confirm remote deployment/restart.
- Optionally add a small regression smoke test for malformed structured output handling.
