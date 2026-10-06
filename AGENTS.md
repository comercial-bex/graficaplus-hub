# Project architecture rules

- Theme roles belong in `src/styles.css`; shared and feature components consume semantic tokens so light and dark modes remain consistent.
- The application sidebar always uses the dark sidebar token set, independently of the selected content theme, because navigation must keep its established identity.
- Contextual help copy is centralized in `src/lib/dicas.ts`, while shared tooltip behavior lives in `src/components/bex/Dica.tsx`, so explanations remain consistent across mouse, keyboard, and touch.