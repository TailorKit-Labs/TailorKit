---
"@patchsmith/cli": patch
"@patchsmith/vite": patch
---

Replace the separate 3 MiB client and server limits with a 10 MiB combined deployment budget covering client code, server code, and both logo variants. The uploaded total and the total before compression must each fit the budget. Logos retain their 256 KiB individual limit; externally hosted runtime downloads are not counted.
