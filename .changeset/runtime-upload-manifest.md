---
"@tailorkit/vite": patch
---

Export upload manifest validation separately from the Vite builder so server runtimes can validate deployment artifacts without loading the compiler or its native bindings.
